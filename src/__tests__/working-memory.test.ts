import { describe, it, expect } from 'vitest';
import { WorkingMemory } from '../memory/working.js';
import type { BrowserState, AccessibilityNode } from '../state/types.js';
import type { ActionDecision } from '../llm/types.js';
import type { ExecutionResult } from '../tools/types.js';

function makeState(url = 'https://example.com'): BrowserState {
  const root: AccessibilityNode = {
    nodeId: 'root', role: 'document', name: '', isInteractive: false,
    isVisible: true, isDisabled: false, children: [], attributes: {},
  };
  return {
    sessionId: 'test', stepIndex: 0, timestamp: Date.now(),
    url, title: 'Test', tabs: [], accessibilityTree: root,
    clickableElements: [], treeHash: 'x', domHash: 'y',
  };
}

function makeDecision(action = 'click'): ActionDecision {
  return {
    reasoning: 'test reasoning',
    action: action as ActionDecision['action'],
    confidence: 0.9,
    requiresHumanApproval: false,
    done: false,
  };
}

function makeResult(success = true): ExecutionResult {
  return { success, action: 'click', durationMs: 50 };
}

describe('WorkingMemory', () => {
  it('starts empty', () => {
    const mem = new WorkingMemory();
    expect(mem.getLastState()).toBeNull();
    expect(mem.getRecentActions()).toHaveLength(0);
  });

  it('tracks last state and decision', () => {
    const mem = new WorkingMemory();
    const state = makeState();
    const decision = makeDecision();
    const result = makeResult();
    mem.update(decision, result, state);
    expect(mem.getLastState()).toEqual(state);
    expect(mem.getLastDecision()).toEqual(decision);
    expect(mem.getLastResult()).toEqual(result);
  });

  it('caps recent actions at 10', () => {
    const mem = new WorkingMemory();
    for (let i = 0; i < 15; i++) {
      mem.update(makeDecision(), makeResult(), makeState());
    }
    expect(mem.getRecentActions()).toHaveLength(10);
  });

  it('resets cleanly', () => {
    const mem = new WorkingMemory();
    mem.update(makeDecision(), makeResult(false), makeState());
    mem.reset();
    expect(mem.getLastState()).toBeNull();
    expect(mem.getRecentActions()).toHaveLength(0);
  });

  it('builds recent actions context string', () => {
    const mem = new WorkingMemory();
    mem.update(makeDecision('click'), makeResult(true), makeState());
    mem.update(makeDecision('type'), makeResult(false), makeState());
    const ctx = mem.buildRecentActionsContext();
    expect(ctx).toContain('✓');
    expect(ctx).toContain('✗');
  });
});
