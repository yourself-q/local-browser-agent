import type { BrowserState, StateDelta } from '../state/types.js';
import type { ActionDecision, ActionType } from '../llm/types.js';
import type { GroundingResult } from '../grounding/types.js';
import type { ExecutionResult } from '../tools/types.js';
import type { VerificationResult } from '../agent/types.js';

// ─── Event type discriminator ─────────────────────────────────────────────────

export type AgentEventType =
  | 'session.started'
  | 'session.ended'
  | 'step.started'
  | 'state.captured'
  | 'state.diffed'
  | 'action.decided'
  | 'action.approved'
  | 'action.rejected'
  | 'grounding.attempted'
  | 'grounding.succeeded'
  | 'grounding.failed'
  | 'action.executing'
  | 'action.succeeded'
  | 'action.failed'
  | 'verification.started'
  | 'verification.passed'
  | 'verification.failed'
  | 'recovery.triggered'
  | 'recovery.succeeded'
  | 'recovery.exhausted'
  | 'task.complete'
  | 'task.failed';

// ─── Typed payload map ────────────────────────────────────────────────────────

export interface EventPayloads {
  'session.started': { task: string; config: Record<string, unknown> };
  'session.ended': { reason: 'complete' | 'failed' | 'cancelled'; stepsRun: number };
  'step.started': { stepIndex: number };
  'state.captured': BrowserState;
  'state.diffed': StateDelta;
  'action.decided': ActionDecision;
  'action.approved': { decision: ActionDecision; approvedBy: 'human' | 'auto' };
  'action.rejected': { decision: ActionDecision; reason: string };
  'grounding.attempted': { decision: ActionDecision };
  'grounding.succeeded': GroundingResult;
  'grounding.failed': GroundingResult;
  'action.executing': { action: ActionType; elementId?: string };
  'action.succeeded': ExecutionResult;
  'action.failed': ExecutionResult;
  'verification.started': { stepIndex: number };
  'verification.passed': VerificationResult;
  'verification.failed': VerificationResult;
  'recovery.triggered': { reason: string; strategy: string; attempt: number };
  'recovery.succeeded': { strategy: string };
  'recovery.exhausted': { reason: string; totalAttempts: number };
  'task.complete': { stepsRun: number; summary: string };
  'task.failed': { reason: string; lastError?: string };
}

// ─── Base event ───────────────────────────────────────────────────────────────

export interface AgentEvent<T extends AgentEventType = AgentEventType> {
  /** UUID v4 */
  id: string;
  type: T;
  sessionId: string;
  stepIndex: number;
  timestamp: number;
  payload: EventPayloads[T];
}

/** Discriminated union of all concrete event types — used for replay and inspection */
export type AnyAgentEvent = {
  [K in AgentEventType]: AgentEvent<K>;
}[AgentEventType];
