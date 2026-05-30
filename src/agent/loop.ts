import type { Page } from 'playwright';
import type { AgentConfig, LoopState, StepOutcome, VerificationResult } from './types.js';
import type { StateCapturer } from '../state/index.js';
import { diffStates } from '../state/index.js';
import { captureDOMSnapshot } from '../state/dom.js';
import type { GroundingEngine } from '../grounding/index.js';
import type { ToolExecutorRegistry } from '../tools/index.js';
import type { OpenAILLMClient } from '../llm/openai.js';
import type { MemoryManager } from '../memory/index.js';
import type { EventStore } from '../events/index.js';
import { buildRecoveryPrompt } from '../prompts/recovery.js';
import { createLogger } from '../runtime/logger.js';
import type { BrowserState } from '../state/types.js';
import type { ActionDecision } from '../llm/types.js';
import type { TabManager } from '../browser/tabs.js';

const log = createLogger('agent:loop');

// ─── Loop context ─────────────────────────────────────────────────────────────

export interface LoopContext {
  config: AgentConfig;
  page: Page;
  state: LoopState;
  capturer: StateCapturer;
  grounding: GroundingEngine;
  executor: ToolExecutorRegistry;
  llm: OpenAILLMClient;
  memory: MemoryManager;
  events: EventStore;
  tabManager: TabManager;
}

// ─── Single agent step ────────────────────────────────────────────────────────

export async function runAgentStep(ctx: LoopContext): Promise<StepOutcome> {
  const { config, page, state, events } = ctx;
  const stepIndex = state.stepIndex;

  events.setStepIndex(stepIndex);
  events.emit('step.started', { stepIndex });

  // ── 1. Capture browser state ──────────────────────────────────────────────
  let currentState: BrowserState;
  try {
    currentState = await ctx.capturer.capture(page, stepIndex);
    events.emit('state.captured', currentState);
  } catch (err) {
    log.error({ err }, 'State capture failed');
    // "Execution context was destroyed" / "Target page … has been closed" are caused by
    // a failed or in-progress navigation (e.g. ERR_NAME_NOT_RESOLVED shows an error page).
    // The page itself may still be usable — let the LLM retry or navigate elsewhere.
    const msg = String(err);
    const isNavRelated =
      msg.includes('Execution context was destroyed') ||
      msg.includes('Target page') ||
      msg.includes('Target closed') ||
      msg.includes('context or browser has been closed');
    return { type: 'failed', reason: `State capture failed: ${msg}`, recoverable: isNavRelated };
  }

  // Compute delta from previous state
  const prevState = ctx.memory.working.getLastState();
  if (prevState !== null) {
    const delta = diffStates(prevState, currentState);
    events.emit('state.diffed', delta);
    state.lastDelta = delta;
  }

  // Log captured elements at info level so they're always visible
  log.info(
    {
      step: stepIndex,
      url: currentState.url,
      elements: currentState.clickableElements.length,
      elementList: currentState.clickableElements
        .map((e) => `[${e.refId}] ${e.role}: "${e.name.slice(0, 40)}"${e.options ? ` options=[${e.options.map((o) => o.text).join(',')}]` : ''}`),
    },
    '── State captured',
  );

  // ── 2. LLM decision ───────────────────────────────────────────────────────
  const history = ctx.memory.getConversationHistory(20);

  // Recovery context: when stuck (2+ consecutive failures), signal the LLM to change approach.
  // The error detail is already in history via addConversationTurn; this adds a systemic header.
  const baseContext = ctx.memory.buildContext(currentState.url);
  const context = state.consecutiveFailures >= 2
    ? `## ⚠️ RECOVERY MODE — ${state.consecutiveFailures} consecutive failures\nYou are stuck. Do NOT retry the same action. Fundamentally change your approach: try a different element, use execute_javascript, take a screenshot to inspect, or navigate away and back.\n\n${baseContext}`
    : baseContext;

  let decision: ActionDecision;
  try {
    const response = await ctx.llm.decide(currentState, history, config.task, context);
    decision = response.decision;
    events.emit('action.decided', decision);

    log.info(
      {
        step: stepIndex,
        action: decision.action,
        target: decision.targetElementId ?? '—',
        description: decision.targetDescription?.slice(0, 60) ?? '—',
        value: decision.value?.slice(0, 60) ?? '—',
        reasoning: decision.reasoning.slice(0, 120),
        confidence: decision.confidence,
      },
      '── LLM decision',
    );

    // Record in episodic memory
    ctx.memory.addConversationTurn({
      role: 'user',
      content: `Step ${stepIndex}: ${currentState.url}\n${JSON.stringify(currentState.clickableElements.slice(0, 20))}`,
      stepIndex,
      timestamp: Date.now(),
    });
    ctx.memory.addConversationTurn({
      role: 'assistant',
      content: JSON.stringify(decision),
      stepIndex,
      timestamp: Date.now(),
    });
  } catch (err) {
    log.error({ err }, 'LLM decision failed');
    return { type: 'failed', reason: `LLM error: ${String(err)}`, recoverable: true };
  }

  // ── 3. Check terminal conditions ──────────────────────────────────────────
  if (decision.done === true) {
    log.info({ stepIndex }, 'LLM signaled task complete');
    events.emit('task.complete', { stepsRun: stepIndex, summary: String(decision.reasoning ?? '') });
    state.done = true;
    return { type: 'done' };
  }

  if (decision.action === 'fail') {
    const failReason = String(decision.error ?? 'LLM decided task cannot be completed');
    log.warn({ reason: failReason }, 'LLM signaled task failure');
    events.emit('task.failed', { reason: failReason });
    state.failed = true;
    state.failureReason = failReason;
    return { type: 'failed', reason: failReason, recoverable: false };
  }

  // ── 4. Human approval (optional) ─────────────────────────────────────────
  if (config.humanApprovalMode && decision.requiresHumanApproval) {
    const approved = await requestHumanApproval(decision);
    if (approved) {
      events.emit('action.approved', { decision, approvedBy: 'human' });
    } else {
      events.emit('action.rejected', { decision, reason: 'Human rejected' });
      return { type: 'skipped', reason: 'Human rejected the action' };
    }
  } else {
    events.emit('action.approved', { decision, approvedBy: 'auto' });
  }

  // ── 5. Ground the action (skip for element-free actions) ─────────────────
  // Actions like navigate/go_back/wait don't target a DOM element.
  // Running grounding on them always fails → skip and execute directly.
  const ELEMENTLESS_ACTIONS = new Set([
    'navigate', 'go_back', 'go_forward', 'reload', 'wait',
    'screenshot', 'accessibility_dump', 'dom_snapshot', 'extract_content',
    'switch_tab', 'close_tab',
    'search', 'execute_python', 'execute_javascript',  // agent tools — no DOM element needed
  ]);

  const domSnapshot = await captureDOMSnapshot(page);

  let groundingElement: import('../grounding/types.js').GroundedElement | undefined;

  if (ELEMENTLESS_ACTIONS.has(decision.action)) {
    // No element needed — execute directly
    log.debug({ action: decision.action }, 'Skipping grounding for element-free action');
    events.emit('grounding.attempted', { decision });
    events.emit('grounding.succeeded', { success: true, strategiesAttempted: [], strategyTimings: {}, element: undefined });
  } else {
    events.emit('grounding.attempted', { decision });
    const groundingResult = await ctx.grounding.resolve(decision, currentState, domSnapshot, page);

    if (!groundingResult.success) {
      events.emit('grounding.failed', groundingResult);
      state.consecutiveFailures++;
      log.warn(
        { step: stepIndex, target: decision.targetElementId, reason: groundingResult.failureReason },
        '── Grounding FAILED',
      );

      // Feed failure back into conversation so LLM can adapt (mirrors reference impl:
      // open-claude-in-chrome returns tool errors to Claude as tool result text).
      const failReason = groundingResult.failureReason ?? 'Grounding failed';
      ctx.memory.addConversationTurn({
        role: 'user',
        content: `[Step ${stepIndex} ERROR]: Action "${decision.action}" on element "${decision.targetElementId ?? decision.targetDescription ?? 'unknown'}" failed — ${failReason}. Try a different targetElementId (use ref_N from the Interactive Elements list), use targetDescription instead, or use screenshot/accessibility_dump to inspect the page first.`,
        stepIndex,
        timestamp: Date.now(),
      });

      events.emit('recovery.triggered', {
        reason: failReason,
        strategy: 'llm-replan',
        attempt: state.consecutiveFailures,
      });
      return { type: 'failed', reason: failReason, recoverable: true };
    }

    events.emit('grounding.succeeded', groundingResult);
    groundingElement = groundingResult.element;
    log.info(
      { step: stepIndex, target: decision.targetElementId, strategy: groundingResult.element?.strategy },
      '── Grounding OK',
    );
  }

  // ── 6. Execute action ─────────────────────────────────────────────────────
  events.emit('action.executing', {
    action: decision.action,
    elementId: groundingElement?.nodeId,
  });

  const execResult = await ctx.executor.execute(
    decision,
    groundingElement,
    page,
    ctx.grounding,
    currentState,
    domSnapshot,
    config.sessionId,
    stepIndex,
    ctx.tabManager,
  );

  // ── 6.5. Tab switch/close: update active page and skip verification ─────────
  // State from the previous page is meaningless after switching — the next step
  // will capture a fresh snapshot from the new active page.
  if ((decision.action === 'switch_tab' || decision.action === 'close_tab') && execResult.success) {
    ctx.page = ctx.tabManager.getActivePage();
    events.emit('verification.passed', {
      passed: true,
      delta: { anythingChanged: true, fromStep: stepIndex, toStep: stepIndex, urlChanged: false, treeChanged: false, domChanged: false, focusChanged: false, nodesAdded: [], nodesRemoved: [], tabsChanged: true, modals: [] },
      expectedChange: `Tab ${decision.action}`,
      observedChange: 'Active page updated',
    });
    state.consecutiveFailures = 0;
    ctx.memory.record(decision, execResult, currentState);
    if (decision.remember) {
      ctx.memory.episodic.addNote(config.sessionId, stepIndex, `[Memory @ step ${stepIndex}] ${decision.remember}`);
    }
    return { type: 'success' };
  }

  if (!execResult.success) {
    events.emit('action.failed', execResult);
    state.consecutiveFailures++;
    log.warn({ step: stepIndex, action: decision.action, error: execResult.error }, '── Action FAILED');

    // Feed failure back into conversation (mirrors reference impl error feedback)
    const execError = execResult.error ?? 'Execution failed';
    ctx.memory.addConversationTurn({
      role: 'user',
      content: `[Step ${stepIndex} ERROR]: Action "${decision.action}" failed to execute — ${execError}. Consider a different approach: try execute_javascript as an escape hatch, or use screenshot to inspect the current state.`,
      stepIndex,
      timestamp: Date.now(),
    });

    if (state.consecutiveFailures < config.maxRetries) {
      events.emit('recovery.triggered', {
        reason: execError,
        strategy: 'regrounding',
        attempt: state.consecutiveFailures,
      });
      return { type: 'failed', reason: execError, recoverable: true };
    }

    events.emit('recovery.exhausted', {
      reason: execError,
      totalAttempts: state.consecutiveFailures,
    });
    return { type: 'failed', reason: execError, recoverable: false };
  }

  events.emit('action.succeeded', execResult);
  log.info({ step: stepIndex, action: decision.action, output: String(execResult.output ?? '').slice(0, 80) }, '── Action OK');

  // ── 7. Verify post-action state ───────────────────────────────────────────
  events.emit('verification.started', { stepIndex });

  const verification = await verifyPostActionState(page, ctx.capturer, currentState, decision, stepIndex);

  if (verification.delta.anythingChanged) {
    events.emit('verification.passed', verification);
    state.consecutiveFailures = 0;
  } else if (
    decision.action === 'wait' ||
    decision.action === 'scroll' ||
    // Read-only / query actions never change DOM state — don't penalize them
    decision.action === 'extract_content' ||
    decision.action === 'screenshot' ||
    decision.action === 'accessibility_dump' ||
    decision.action === 'dom_snapshot' ||
    decision.action === 'search' ||
    decision.action === 'execute_python' ||
    decision.action === 'execute_javascript'
  ) {
    events.emit('verification.passed', verification);
    state.consecutiveFailures = 0;
  } else {
    events.emit('verification.failed', verification);
    log.warn({ action: decision.action, url: currentState.url }, 'Action did not change state');
    // Not a hard failure — maybe the page was already in the right state
    state.consecutiveFailures++;
  }

  // ── 8. Update memory ──────────────────────────────────────────────────────
  ctx.memory.record(decision, execResult, currentState);

  // Persist any fact the LLM explicitly flagged as important.
  // Survives context window rotation — appears in buildContext() every future step.
  if (decision.remember) {
    ctx.memory.episodic.addNote(config.sessionId, stepIndex, `[Memory @ step ${stepIndex}] ${decision.remember}`);
    log.info({ stepIndex, note: decision.remember.slice(0, 80) }, 'LLM persisted a memory note');
  }

  // Inject action output into conversation so the LLM sees it next step.
  // Critical for read actions (extract_content, search, execute_python, etc.)
  // where the output IS the information the model needs to act on.
  if (execResult.success && execResult.output) {
    const MAX_OUTPUT_IN_HISTORY = 4000; // chars — keep context window sane

    // Screenshot action: pass image as imageBase64 so the LLM actually sees it.
    // Previously, { base64, savedTo } was String()ified to "[object Object]" — useless.
    if (decision.action === 'screenshot' && typeof execResult.output === 'object' && execResult.output !== null && 'base64' in execResult.output) {
      const b64 = (execResult.output as { base64: string }).base64;
      ctx.memory.addConversationTurn({
        role: 'user',
        content: '[Screenshot captured]',
        imageBase64: b64,
        stepIndex,
        timestamp: Date.now(),
      });
    } else {
      ctx.memory.addConversationTurn({
        role: 'user',
        content: `[Result of ${decision.action}]:\n${String(execResult.output).slice(0, MAX_OUTPUT_IN_HISTORY)}`,
        stepIndex,
        timestamp: Date.now(),
      });
    }
  }

  return { type: 'success' };
}

// ─── Post-action verification ─────────────────────────────────────────────────

async function verifyPostActionState(
  page: Page,
  capturer: StateCapturer,
  prevState: BrowserState,
  decision: ActionDecision,
  stepIndex: number,
): Promise<VerificationResult> {
  // Wait for DOMContentLoaded (resolves near-instantly if the page is already loaded,
  // catches synchronous DOM mutations after clicks/form submits without a fixed sleep).
  await page.waitForLoadState('domcontentloaded', { timeout: 2000 }).catch(() => {});
  // Then wait for network idle to catch AJAX / server-side round-trips (e.g. ASP POST→redirect).
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

  try {
    const newState = await capturer.capture(page, stepIndex);
    const delta = diffStates(prevState, newState);

    return {
      passed: delta.anythingChanged,
      delta,
      expectedChange: `Action "${decision.action}" should change page state`,
      observedChange: summarizeDelta(delta),
    };
  } catch {
    // State capture after action failed — treat as pass (action might have navigated away)
    return {
      passed: true,
      delta: {
        fromStep: prevState.stepIndex,
        toStep: stepIndex,
        urlChanged: page.url() !== prevState.url,
        treeChanged: true,
        domChanged: true,
        focusChanged: false,
        nodesAdded: [],
        nodesRemoved: [],
        tabsChanged: false,
        modals: [],
        anythingChanged: true,
      },
      expectedChange: 'Navigation or page change',
      observedChange: 'State capture failed after action (likely navigated away)',
    };
  }
}

function summarizeDelta(delta: ReturnType<typeof diffStates>): string {
  const parts: string[] = [];
  if (delta.urlChanged) parts.push(`URL: ${delta.previousUrl} → ${delta.currentUrl}`);
  if (delta.treeChanged) parts.push('Accessibility tree changed');
  if (delta.domChanged) parts.push('DOM changed');
  if (delta.focusChanged) parts.push('Focus changed');
  if (delta.modals.length > 0) parts.push(`Modals: ${delta.modals.map((m) => m.type).join(', ')}`);
  if (parts.length === 0) parts.push('No observable change');
  return parts.join('; ');
}

// ─── Human approval (simple stdin prompt) ────────────────────────────────────

async function requestHumanApproval(decision: ActionDecision): Promise<boolean> {
  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    const prompt =
      `\n[APPROVAL REQUIRED]\n` +
      `Action: ${String(decision.action)}\n` +
      `Target: ${String(decision.targetDescription ?? decision.targetElementId ?? 'unknown')}\n` +
      `Reasoning: ${String(decision.reasoning ?? '').slice(0, 120)}\n` +
      `Approve? [y/N] `;

    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}
