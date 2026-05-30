import type { AgentConfig, AgentResult, LoopState } from './types.js';
import { runAgentStep, type LoopContext } from './loop.js';
import { BrowserManager } from '../browser/index.js';
import { StateCapturer } from '../state/index.js';
import { GroundingEngine } from '../grounding/index.js';
import { ToolExecutorRegistry } from '../tools/index.js';
import { OpenAILLMClient } from '../llm/openai.js';
import { MemoryManager } from '../memory/index.js';
import { EventStore } from '../events/index.js';
import { SessionManager } from '../runtime/session.js';
import { ScreenshotVisionProvider } from '../grounding/vision/screenshot.js';
import { ActionLoopDetector } from './loop-detector.js';
import { createLogger } from '../runtime/logger.js';

const log = createLogger('agent');

// ─── Agent orchestrator ───────────────────────────────────────────────────────

export class AgentOrchestrator {
  private readonly browserManager = new BrowserManager();
  private readonly sessionManager: SessionManager;

  constructor(private readonly config: AgentConfig) {
    this.sessionManager = new SessionManager(config.sessionsDir);
  }

  async run(): Promise<AgentResult> {
    const startMs = Date.now();
    const { config } = this;

    // Initialize session
    const sessionId = this.sessionManager.start(config);
    const sessionDir = this.sessionManager.sessionDir(sessionId);

    log.info(
      { sessionId, task: config.task, deterministicMode: config.deterministicMode },
      'Agent session starting',
    );

    // Initialize event store
    const events = new EventStore(sessionId, this.sessionManager.eventsPath(sessionId));
    events.emit('session.started', {
      task: config.task,
      config: {
        model: config.model,
        deterministicMode: config.deterministicMode,
        maxSteps: config.maxSteps,
        humanApprovalMode: config.humanApprovalMode,
      },
    });

    // Initialize memory
    const memory = new MemoryManager(sessionId, this.sessionManager.dbPath(sessionId));

    // Inject text reference files as permanent task notes (visible every step via buildContext).
    const textRefs = (config.referenceFiles ?? []).filter((f) => f.type === 'text');
    for (const f of textRefs) {
      memory.episodic.addNote(
        sessionId,
        -1,
        `[Reference file: ${f.name}]\n${f.content}`,
      );
      log.info({ file: f.name }, 'Injected text reference file into task notes');
    }

    // Connect to Chrome
    const pageWrapper = await this.browserManager.connect({
      port: config.chromeDebuggingPort,
      host: config.chromeDebuggingHost,
      timeoutMs: 15000,
      retries: 3,
    });

    const page = pageWrapper.page;

    // Initialize components
    const screenshotMode = config.screenshotMode;
    const capturer = new StateCapturer(sessionId, (step) => {
      if (screenshotMode === 'always') return true;
      if (screenshotMode === 'never') return false;
      return false; // on_failure: screenshots taken in recovery, not every step
    });

    // Vision provider — always enabled as last-resort grounding fallback.
    // deterministicMode does NOT disable vision; it only affects temperature/planning.
    const visionProvider = new ScreenshotVisionProvider(
      config.lmStudioBaseUrl,
      config.lmStudioApiKey,
      config.model,
    );

    const grounding = new GroundingEngine(visionProvider);
    const executor = new ToolExecutorRegistry(config.customTools ?? []);
    const referenceImages = (config.referenceFiles ?? [])
      .filter((f) => f.type === 'image')
      .map((f) => ({
        name: f.name,
        base64: f.content,
        mimeType: f.mimeType ?? 'image/png',
      }));

    const llm = new OpenAILLMClient({
      baseUrl: config.lmStudioBaseUrl,
      apiKey: config.lmStudioApiKey,
      model: config.model,
      deterministicMode: config.deterministicMode,
      maxContextTurns: 20,
      maxSteps: config.maxSteps,
      maxTokens: config.maxTokens ?? 2048,
      stripThinkingBlocks: config.stripThinkingBlocks ?? true,
      jsonMode: config.jsonMode ?? false,
      referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
      customTools: config.customTools,
      httpReferer: config.httpReferer,
      xTitle: config.xTitle,
    });

    // Initialize loop state
    const loopState: LoopState = {
      stepIndex: 0,
      consecutiveFailures: 0,
      done: false,
      failed: false,
    };

    const ctx: LoopContext = {
      config: { ...config, sessionId },
      page,
      state: loopState,
      capturer,
      grounding,
      executor,
      llm,
      memory,
      events,
      tabManager: pageWrapper.tabs,
      loopDetector: new ActionLoopDetector(),
    };

    // ── Main agent loop ───────────────────────────────────────────────────────
    try {
      while (!loopState.done && !loopState.failed && loopState.stepIndex < config.maxSteps) {
        const outcome = await Promise.race([
          runAgentStep(ctx),
          timeout(config.stepTimeoutMs),
        ]);

        if (outcome === TIMEOUT_SENTINEL) {
          log.error({ stepIndex: loopState.stepIndex }, 'Step timed out');
          loopState.consecutiveFailures++;
          if (loopState.consecutiveFailures >= config.maxRetries) {
            loopState.failed = true;
            loopState.failureReason = `Step timeout after ${config.stepTimeoutMs}ms`;
            break;
          }
        } else {
          if (outcome.type === 'done') break;
          if (outcome.type === 'failed' && !outcome.recoverable) break;
        }

        loopState.stepIndex++;

        // Guard: too many consecutive failures
        if (loopState.consecutiveFailures >= config.maxRetries) {
          log.error({ failures: loopState.consecutiveFailures }, 'Max consecutive failures reached');
          loopState.failed = true;
          loopState.failureReason = `${loopState.consecutiveFailures} consecutive failures`;
          break;
        }
      }

      const maxStepsReached = loopState.stepIndex >= config.maxSteps && !loopState.done;
      if (maxStepsReached) {
        log.warn({ maxSteps: config.maxSteps }, 'Max steps reached');
        loopState.failed = true;
        loopState.failureReason = `Max steps (${config.maxSteps}) reached`;
      }
    } finally {
      memory.dispose();
      await this.browserManager.disconnect();

      const status = loopState.done ? 'complete' : 'failed';
      this.sessionManager.end(sessionId, status, loopState.stepIndex);
      events.emit('session.ended', {
        reason: loopState.done ? 'complete' : 'failed',
        stepsRun: loopState.stepIndex,
      });
    }

    const durationMs = Date.now() - startMs;
    const success = loopState.done && !loopState.failed;

    log.info(
      { sessionId, success, stepsRun: loopState.stepIndex, durationMs },
      'Agent session complete',
    );

    return {
      sessionId,
      task: config.task,
      stepsRun: loopState.stepIndex,
      success,
      summary: success
        ? `Task completed in ${loopState.stepIndex} steps`
        : loopState.failureReason ?? 'Task failed',
      durationMs,
      failureReason: loopState.failureReason,
    };
  }
}

// ─── Timeout helper ───────────────────────────────────────────────────────────

const TIMEOUT_SENTINEL = Symbol('timeout');

function timeout(ms: number): Promise<typeof TIMEOUT_SENTINEL> {
  return new Promise((resolve) => setTimeout(() => resolve(TIMEOUT_SENTINEL), ms));
}
