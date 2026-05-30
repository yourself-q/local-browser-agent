import { readFileSync, existsSync } from 'node:fs';
import type { AnyAgentEvent } from './types.js';
import { createLogger } from '../runtime/logger.js';

const log = createLogger('events:replay');

// ─── Replay engine ─────────────────────────────────────────────────────────────

export interface ReplayOptions {
  fromStep?: number;
  toStep?: number;
  /** When true, re-execute actions and compare resulting states */
  activeReplay?: boolean;
}

export interface ReplayReport {
  totalEvents: number;
  stepsReplayed: number;
  divergences: ReplayDivergence[];
}

export interface ReplayDivergence {
  stepIndex: number;
  eventType: string;
  expected: unknown;
  actual: unknown;
  description: string;
}

/**
 * ReplayEngine loads a session's JSONL event log and replays it.
 *
 * Passive replay (default): streams events in order, useful for inspection.
 * Active replay: re-executes actions against the live browser and compares
 * resulting state to recorded state, detecting non-determinism.
 */
export class ReplayEngine {
  constructor(private readonly eventsPath: string) {}

  /** Load all events from disk */
  loadEvents(options: ReplayOptions = {}): AnyAgentEvent[] {
    if (!existsSync(this.eventsPath)) {
      throw new Error(`Events file not found: ${this.eventsPath}`);
    }

    const lines = readFileSync(this.eventsPath, 'utf8')
      .split('\n')
      .filter(Boolean);

    const events = lines.map((line) => JSON.parse(line) as AnyAgentEvent);

    return events.filter((e) => {
      if (options.fromStep !== undefined && e.stepIndex < options.fromStep) return false;
      if (options.toStep !== undefined && e.stepIndex > options.toStep) return false;
      return true;
    });
  }

  /** Print a human-readable event log to stdout */
  inspect(options: ReplayOptions = {}): void {
    const events = this.loadEvents(options);

    log.info({ totalEvents: events.length }, 'Session event log');

    for (const event of events) {
      const ts = new Date(event.timestamp).toISOString();
      const summary = summarizeEvent(event);
      process.stdout.write(`[${ts}] step=${event.stepIndex} ${event.type} — ${summary}\n`);
    }
  }

  /** Group events by step */
  groupByStep(options: ReplayOptions = {}): Map<number, AnyAgentEvent[]> {
    const events = this.loadEvents(options);
    const grouped = new Map<number, AnyAgentEvent[]>();

    for (const event of events) {
      const step = grouped.get(event.stepIndex) ?? [];
      step.push(event);
      grouped.set(event.stepIndex, step);
    }

    return grouped;
  }
}

// ─── Event summarizer ─────────────────────────────────────────────────────────

function summarizeEvent(event: AnyAgentEvent): string {
  switch (event.type) {
    case 'session.started':
      return `task="${(event.payload as { task: string }).task}"`;
    case 'state.captured': {
      const p = event.payload as { url: string; clickableElements: unknown[] };
      return `url=${p.url} interactive=${p.clickableElements.length}`;
    }
    case 'action.decided': {
      const p = event.payload as { action: string; reasoning: string; confidence: number };
      return `action=${p.action} confidence=${p.confidence.toFixed(2)} reason="${p.reasoning.slice(0, 60)}..."`;
    }
    case 'grounding.succeeded': {
      const p = event.payload as { element?: { strategy: string; nodeId: string } };
      return `strategy=${p.element?.strategy} nodeId=${p.element?.nodeId?.slice(0, 8)}`;
    }
    case 'action.succeeded':
    case 'action.failed': {
      const p = event.payload as { action: string; durationMs: number; error?: string };
      return `action=${p.action} ${p.error ? `error="${p.error}"` : `took=${p.durationMs}ms`}`;
    }
    case 'recovery.triggered': {
      const p = event.payload as { reason: string; strategy: string };
      return `strategy=${p.strategy} reason="${p.reason}"`;
    }
    default:
      return JSON.stringify(event.payload).slice(0, 80);
  }
}
