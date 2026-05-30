import { describe, it, expect } from 'vitest';
import {
  normalizeA11yTree,
  flattenInteractive,
  computeNodeId,
  hashTree,
  type RawA11yNode,
} from '../state/normalizer.js';

describe('normalizeA11yTree', () => {
  it('normalizes a button node', () => {
    const raw: RawA11yNode = {
      role: 'button',
      name: 'Submit',
      children: [],
    };
    const node = normalizeA11yTree(raw);
    expect(node).not.toBeNull();
    expect(node!.role).toBe('button');
    expect(node!.name).toBe('Submit');
    expect(node!.isInteractive).toBe(true);
    expect(node!.isDisabled).toBe(false);
  });

  it('filters noise nodes with no name or children', () => {
    const raw: RawA11yNode = {
      role: 'none',
      name: '',
      children: [],
    };
    expect(normalizeA11yTree(raw)).toBeNull();
  });

  it('preserves noise nodes that have children', () => {
    const raw: RawA11yNode = {
      role: 'none',
      children: [{ role: 'button', name: 'Click me' }],
    };
    const node = normalizeA11yTree(raw);
    // The noise root is kept because it has children
    expect(node).not.toBeNull();
    expect(node!.children.length).toBe(1);
    expect(node!.children[0]!.role).toBe('button');
  });

  it('normalizes role aliases', () => {
    const raw: RawA11yNode = { role: 'push button', name: 'Go' };
    const node = normalizeA11yTree(raw);
    expect(node!.role).toBe('button');
  });

  it('marks disabled nodes', () => {
    const raw: RawA11yNode = { role: 'button', name: 'Disabled', disabled: true };
    const node = normalizeA11yTree(raw);
    expect(node!.isDisabled).toBe(true);
  });

  it('builds attributes for checked state', () => {
    const raw: RawA11yNode = { role: 'checkbox', name: 'Accept', checked: true };
    const node = normalizeA11yTree(raw);
    expect(node!.attributes['aria-checked']).toBe('true');
  });
});

describe('flattenInteractive', () => {
  it('extracts only interactive visible enabled nodes', () => {
    const raw: RawA11yNode = {
      role: 'document',
      name: '',
      children: [
        { role: 'button', name: 'A' },
        { role: 'button', name: 'B', disabled: true },
        { role: 'link', name: 'C' },
        { role: 'paragraph', name: 'text' },
      ],
    };
    const tree = normalizeA11yTree(raw)!;
    const interactive = flattenInteractive(tree);
    const names = interactive.map((n) => n.name);
    expect(names).toContain('A');
    expect(names).toContain('C');
    expect(names).not.toContain('B'); // disabled
    expect(names).not.toContain('text'); // not interactive
  });
});

describe('computeNodeId', () => {
  it('produces stable IDs for same input', () => {
    const id1 = computeNodeId('button', 'Submit', 'document/button:Submit');
    const id2 = computeNodeId('button', 'Submit', 'document/button:Submit');
    expect(id1).toBe(id2);
  });

  it('produces different IDs for different inputs', () => {
    const id1 = computeNodeId('button', 'Submit', 'document/button:Submit');
    const id2 = computeNodeId('button', 'Cancel', 'document/button:Cancel');
    expect(id1).not.toBe(id2);
  });

  it('returns a 16-char hex string', () => {
    const id = computeNodeId('link', 'Home', 'nav/link:Home');
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('hashTree', () => {
  it('produces consistent hash for same tree', () => {
    const raw: RawA11yNode = { role: 'button', name: 'A' };
    const tree = normalizeA11yTree(raw)!;
    expect(hashTree(tree)).toBe(hashTree(tree));
  });

  it('produces different hash when name changes', () => {
    const tree1 = normalizeA11yTree({ role: 'button', name: 'A' })!;
    const tree2 = normalizeA11yTree({ role: 'button', name: 'B' })!;
    expect(hashTree(tree1)).not.toBe(hashTree(tree2));
  });
});
