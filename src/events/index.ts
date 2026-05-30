import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { AgentEventType, AnyAgentEvent, EventPayloads } from './types.js';
import { createLogger } from '../runtime/logger.js';

export type { AgentEventType, AnyAgentEvent, EventPayloads } from './types.js';

const log = createLogger('events');

// ─── Event store (append-only JSONL) ─────────────────────────────────────────

export class EventStore {
  private stepIndex = 0;

  constructor(
    private readonly sessionId: string,
    private readonly eventsPath: string,
  ) {}

  /**
   * Append a typed event to the JSONL event log.
   * Returns the emitted event for in-process consumption.
   */
  emit<T extends AgentEventType>(
    type: T,
    payload: EventPayloads[T],
    stepIndex?: number,
  ): AnyAgentEvent & { type: T } {
    const event = {
      id: randomUUID(),
      type,
      sessionId: this.sessionId,
      stepIndex: stepIndex ?? this.stepIndex,
      timestamp: Date.now(),
      payload,
    } as AnyAgentEvent & { type: T };

    appendFileSync(this.eventsPath, JSON.stringify(event) + '\n');

    log.trace({ type, id: event.id }, 'Event emitted');

    return event;
  }

  setStepIndex(index: number): void {
    this.stepIndex = index;
  }

  /** Read all events for a session from disk */
  readAll(): AnyAgentEvent[] {
    if (!existsSync(this.eventsPath)) return [];
    return readFileSync(this.eventsPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AnyAgentEvent);
  }

  /** Read events from a specific step onwards */
  readFrom(fromStep: number): AnyAgentEvent[] {
    return this.readAll().filter((e) => e.stepIndex >= fromStep);
  }

  /** Get the last event of a given type */
  lastOf<T extends AgentEventType>(type: T): (AnyAgentEvent & { type: T }) | undefined {
    const all = this.readAll();
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i]?.type === type) return all[i] as AnyAgentEvent & { type: T };
    }
    return undefined;
  }
}
