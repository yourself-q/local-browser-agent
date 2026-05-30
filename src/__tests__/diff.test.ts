import { describe, it, expect } from 'vitest';
import { diffStates } from '../state/diff.js';
import type { BrowserState, AccessibilityNode } from '../state/types.js';

function makeState(overrides: Partial<BrowserState>): BrowserState {
  const root: AccessibilityNode = {
    nodeId: 'root',
    role: 'document',
    name: '',
    isInteractive: false,
    isVisible: true,
    isDisabled: false,
    children: [],
    attributes: {},
  };

  return {
    sessionId: 'test',
    stepIndex: 0,
    timestamp: Date.now(),
    url: 'https://example.com',
    title: 'Example',
    tabs: [{ index: 0, url: 'https://example.com', title: 'Example', isActive: true }],
    accessibilityTree: root,
    clickableElements: [],
    treeHash: 'abc123',
    domHash: 'def456',
    ...overrides,
  };
}

describe('diffStates', () => {
  it('detects URL change', () => {
    const prev = makeState({ url: 'https://example.com', stepIndex: 0 });
    const curr = makeState({ url: 'https://example.com/page', stepIndex: 1 });
    const delta = diffStates(prev, curr);
    expect(delta.urlChanged).toBe(true);
    expect(delta.previousUrl).toBe('https://example.com');
    expect(delta.currentUrl).toBe('https://example.com/page');
    expect(delta.anythingChanged).toBe(true);
  });

  it('detects no change when states are equal', () => {
    const prev = makeState({ stepIndex: 0 });
    const curr = makeState({ stepIndex: 1 });
    const delta = diffStates(prev, curr);
    expect(delta.urlChanged).toBe(false);
    expect(delta.treeChanged).toBe(false);
    expect(delta.domChanged).toBe(false);
    expect(delta.anythingChanged).toBe(false);
  });

  it('detects a11y tree change via hash', () => {
    const prev = makeState({ treeHash: 'hash1', stepIndex: 0 });
    const curr = makeState({ treeHash: 'hash2', stepIndex: 1 });
    const delta = diffStates(prev, curr);
    expect(delta.treeChanged).toBe(true);
    expect(delta.anythingChanged).toBe(true);
  });

  it('detects modal appearance', () => {
    const dialog: AccessibilityNode = {
      nodeId: 'dialog-1',
      role: 'dialog',
      name: 'Confirm',
      isInteractive: false,
      isVisible: true,
      isDisabled: false,
      children: [],
      attributes: {},
    };
    const prev = makeState({ stepIndex: 0 });
    const curr = makeState({
      stepIndex: 1,
      treeHash: 'changed',
      accessibilityTree: {
        nodeId: 'root',
        role: 'document',
        name: '',
        isInteractive: false,
        isVisible: true,
        isDisabled: false,
        children: [dialog],
        attributes: {},
      },
    });
    const delta = diffStates(prev, curr);
    expect(delta.modals.length).toBe(1);
    expect(delta.modals[0]!.type).toBe('appeared');
  });

  it('detects added a11y nodes', () => {
    const newNode: AccessibilityNode = {
      nodeId: 'new-btn',
      role: 'button',
      name: 'New Button',
      isInteractive: true,
      isVisible: true,
      isDisabled: false,
      children: [],
      attributes: {},
    };
    const prev = makeState({ stepIndex: 0 });
    const curr = makeState({
      stepIndex: 1,
      treeHash: 'changed',
      accessibilityTree: {
        nodeId: 'root',
        role: 'document',
        name: '',
        isInteractive: false,
        isVisible: true,
        isDisabled: false,
        children: [newNode],
        attributes: {},
      },
    });
    const delta = diffStates(prev, curr);
    expect(delta.nodesAdded.some((n) => n.nodeId === 'new-btn')).toBe(true);
  });
});
