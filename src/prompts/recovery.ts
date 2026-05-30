import type { BrowserState } from '../state/types.js';
import type { ActionDecision } from '../llm/types.js';

// ─── Recovery prompt builder ──────────────────────────────────────────────────

export function buildRecoveryPrompt(
  task: string,
  state: BrowserState,
  failedDecision: ActionDecision,
  failureReason: string,
  attempt: number,
  maxAttempts: number,
): string {
  const clickableList = state.clickableElements
    .slice(0, 60)
    .map((el) => `  - [${el.nodeId}] ${el.role}: "${el.name}"`)
    .join('\n');

  return `## Task
${task}

## RECOVERY MODE — Attempt ${attempt}/${maxAttempts}

The previous action failed. You must choose a different approach.

### Failed Action
Action: ${failedDecision.action}
Target: ${failedDecision.targetDescription ?? failedDecision.targetElementId ?? 'unknown'}
Reason it failed: ${failureReason}

## Current Browser State
URL: ${state.url}
Title: ${state.title}

### Interactive Elements
${clickableList || '  (no interactive elements found)'}

## Recovery Instruction
1. Analyze WHY the action failed.
2. Choose a DIFFERENT strategy.
3. Consider: scrolling to find the element, using a different element, navigating differently.
4. Do NOT retry the exact same action that failed.

Respond with a JSON object as specified in the system prompt.`;
}
