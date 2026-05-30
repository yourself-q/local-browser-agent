import type { Page } from 'playwright';
import type { ExecutionResult } from '../types.js';
import type { GroundingEngine } from '../../grounding/index.js';
import type { BrowserState } from '../../state/types.js';
import type { DOMSnapshot } from '../../state/dom.js';

// ─── Symbolic action (Refinement 3) ──────────────────────────────────────────

/**
 * Symbolic actions are high-level, planner-facing operations that decompose
 * into one or more primitive Playwright operations at execution time.
 *
 * Raw Playwright primitives (click, type, scroll) remain internal.
 * The LLM plans at the symbolic level; the executor handles decomposition.
 */
export interface SymbolicAction<TInput = unknown> {
  readonly name: string;
  readonly description: string;

  execute(input: TInput, ctx: SymbolicActionContext): Promise<ExecutionResult>;
}

export interface SymbolicActionContext {
  page: Page;
  grounding: GroundingEngine;
  state: BrowserState;
  domSnapshot: DOMSnapshot;
  sessionId: string;
  stepIndex: number;
}
