import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventStore } from '../events/index.js';

const TEST_DIR = join(tmpdir(), 'browser-agent-test-' + Date.now());

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

describe('EventStore', () => {
  it('appends events and reads them back', () => {
    const store = new EventStore('session-1', join(TEST_DIR, 'events.jsonl'));
    store.emit('session.started', { task: 'test task', config: {} });
    store.emit('step.started', { stepIndex: 0 });

    const events = store.readAll();
    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe('session.started');
    expect(events[1]!.type).toBe('step.started');
  });

  it('assigns unique IDs to events', () => {
    const store = new EventStore('session-2', join(TEST_DIR, 'events2.jsonl'));
    store.emit('step.started', { stepIndex: 0 });
    store.emit('step.started', { stepIndex: 1 });

    const events = store.readAll();
    expect(events[0]!.id).not.toBe(events[1]!.id);
  });

  it('reads events from a step onwards', () => {
    const store = new EventStore('session-3', join(TEST_DIR, 'events3.jsonl'));
    store.setStepIndex(0);
    store.emit('step.started', { stepIndex: 0 });
    store.setStepIndex(1);
    store.emit('step.started', { stepIndex: 1 });
    store.setStepIndex(2);
    store.emit('step.started', { stepIndex: 2 });

    const from1 = store.readFrom(1);
    expect(from1).toHaveLength(2);
    expect(from1[0]!.stepIndex).toBe(1);
  });

  it('returns empty array when no events file exists', () => {
    const store = new EventStore('session-4', join(TEST_DIR, 'nonexistent.jsonl'));
    expect(store.readAll()).toEqual([]);
  });

  it('finds last event of a type', () => {
    const store = new EventStore('session-5', join(TEST_DIR, 'events5.jsonl'));
    store.setStepIndex(0);
    store.emit('step.started', { stepIndex: 0 });
    store.setStepIndex(1);
    store.emit('step.started', { stepIndex: 1 });

    const last = store.lastOf('step.started');
    expect(last).not.toBeUndefined();
    expect(last!.payload.stepIndex).toBe(1);
  });
});
