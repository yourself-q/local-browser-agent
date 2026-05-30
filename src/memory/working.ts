import type { BrowserState } from '../state/types.js';
import type { ActionDecision } from '../llm/types.js';
import type { ExecutionResult } from '../tools/types.js';

// ─── Working memory (Refinement 4) ───────────────────────────────────────────

/**
 * In-memory store for the current task/browser state.
 * Fast, ephemeral — does NOT persist between sessions.
 * Cleared on session start.
 *
 * Never mixed with episodic (long-term) memory.
 */
export class WorkingMemory {
  private lastState: BrowserState | null = null;
  private lastDecision: ActionDecision | null = null;
  private lastResult: ExecutionResult | null = null;
  private consecutiveFailures = 0;
  private readonly recentActions: Array<{ decision: ActionDecision; result: ExecutionResult }> = [];
  private readonly MAX_RECENT = 10;

  update(decision: ActionDecision, result: ExecutionResult, state: BrowserState): void {
    this.lastState = state;
    this.lastDecision = decision;
    this.lastResult = result;

    if (!result.success) {
      this.consecutiveFailures++;
    } else {
      this.consecutiveFailures = 0;
    }

    this.recentActions.push({ decision, result });
    if (this.recentActions.length > this.MAX_RECENT) {
      this.recentActions.shift();
    }
  }

  getLastState(): BrowserState | null {
    return this.lastState;
  }

  getLastDecision(): ActionDecision | null {
    return this.lastDecision;
  }

  getLastResult(): ExecutionResult | null {
    return this.lastResult;
  }

  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  getRecentActions(): Array<{ decision: ActionDecision; result: ExecutionResult }> {
    return [...this.recentActions];
  }

  /** Build a compact summary of recent actions for LLM context */
  buildRecentActionsContext(): string {
    if (this.recentActions.length === 0) return 'No actions taken yet.';

    return this.recentActions
      .map(({ decision, result }, i) => {
        const status = result.success ? '✓' : '✗';
        const error = result.error ? ` (${result.error.slice(0, 60)})` : '';
        const reasoning = String(decision.reasoning ?? '').slice(0, 80);
        return `${i + 1}. ${status} ${String(decision.action)} — ${reasoning}${error}`;
      })
      .join('\n');
  }

  reset(): void {
    this.lastState = null;
    this.lastDecision = null;
    this.lastResult = null;
    this.consecutiveFailures = 0;
    this.recentActions.length = 0;
  }
}
