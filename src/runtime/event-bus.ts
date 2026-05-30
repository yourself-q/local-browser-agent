import { EventEmitter } from 'node:events';
import type { AgentEventType, AnyAgentEvent, EventPayloads } from '../events/types.js';

// ─── Typed event bus ──────────────────────────────────────────────────────────

/**
 * Strongly-typed event bus. All agent events flow through here before being
 * persisted to the EventStore and dispatched to observers.
 */
export class AgentEventBus extends EventEmitter {
  override emit<T extends AgentEventType>(type: T, event: AnyAgentEvent & { type: T }): boolean {
    return super.emit(type, event);
  }

  override on<T extends AgentEventType>(
    type: T,
    listener: (event: AgentEvent<T>) => void,
  ): this {
    return super.on(type, listener as (arg: unknown) => void);
  }

  override once<T extends AgentEventType>(
    type: T,
    listener: (event: AgentEvent<T>) => void,
  ): this {
    return super.once(type, listener as (arg: unknown) => void);
  }

  override off<T extends AgentEventType>(
    type: T,
    listener: (event: AgentEvent<T>) => void,
  ): this {
    return super.off(type, listener as (arg: unknown) => void);
  }
}

// Local type alias for conciseness
type AgentEvent<T extends AgentEventType> = {
  id: string;
  type: T;
  sessionId: string;
  stepIndex: number;
  timestamp: number;
  payload: EventPayloads[T];
};
