import { describe, it, expect } from 'vitest';
import { computeSemanticFingerprint, normalizeName, isLandmark } from '../state/fingerprint.js';
import { normalizeA11yTree, type RawA11yNode } from '../state/normalizer.js';

describe('computeSemanticFingerprint', () => {
  it('produces stable hash for same input', () => {
    const f1 = computeSemanticFingerprint('button', 'Submit', 'main', 0);
    const f2 = computeSemanticFingerprint('button', 'Submit', 'main', 0);
    expect(f1.hash).toBe(f2.hash);
  });

  it('produces different hashes for different names', () => {
    const f1 = computeSemanticFingerprint('button', 'Submit', 'main', 0);
    const f2 = computeSemanticFingerprint('button', 'Cancel', 'main', 0);
    expect(f1.hash).not.toBe(f2.hash);
  });

  it('produces different hashes for different landmark contexts', () => {
    const f1 = computeSemanticFingerprint('link', 'Home', 'navigation', 0);
    const f2 = computeSemanticFingerprint('link', 'Home', 'main', 0);
    expect(f1.hash).not.toBe(f2.hash);
  });

  it('produces different hashes for different sibling indices', () => {
    const f1 = computeSemanticFingerprint('button', '', 'main', 0);
    const f2 = computeSemanticFingerprint('button', '', 'main', 1);
    expect(f1.hash).not.toBe(f2.hash);
  });

  it('produces a 16-char hex hash', () => {
    const f = computeSemanticFingerprint('button', 'OK', 'dialog', 0);
    expect(f.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('normalizes name (whitespace, case)', () => {
    const f1 = computeSemanticFingerprint('button', 'Submit   Form', 'main', 0);
    const f2 = computeSemanticFingerprint('button', 'Submit Form', 'main', 0);
    expect(f1.hash).toBe(f2.hash);
  });

  it('truncates long names to 80 chars for hashing', () => {
    const long = 'a'.repeat(200);
    const f = computeSemanticFingerprint('link', long, 'main', 0);
    expect(f.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('produces human-readable debug string', () => {
    const f = computeSemanticFingerprint('button', 'Submit', 'main', 2);
    expect(f.debug).toBe('button:submit@main[2]');
  });
});

describe('normalizeName', () => {
  it('trims whitespace', () => {
    expect(normalizeName('  Hello  ')).toBe('Hello');
  });

  it('collapses internal whitespace', () => {
    expect(normalizeName('Submit   Form')).toBe('Submit Form');
  });

  it('truncates to 80 chars', () => {
    expect(normalizeName('x'.repeat(100))).toHaveLength(80);
  });
});

describe('isLandmark', () => {
  it('identifies landmark roles', () => {
    expect(isLandmark('main')).toBe(true);
    expect(isLandmark('navigation')).toBe(true);
    expect(isLandmark('dialog')).toBe(true);
    expect(isLandmark('banner')).toBe(true);
  });

  it('rejects non-landmark roles', () => {
    expect(isLandmark('button')).toBe(false);
    expect(isLandmark('link')).toBe(false);
    expect(isLandmark('textbox')).toBe(false);
  });
});

describe('Normalizer with semantic fingerprinting', () => {
  it('assigns different nodeIds to sibling buttons with same name in same landmark', () => {
    // Two buttons with the same name in the same landmark should get different IDs
    // (distinguished by sibling index)
    const raw: RawA11yNode = {
      role: 'main',
      name: '',
      children: [
        { role: 'button', name: 'Close' },
        { role: 'button', name: 'Close' }, // duplicate name
      ],
    };
    const tree = normalizeA11yTree(raw);
    expect(tree).not.toBeNull();
    const buttons = tree!.children.filter((c) => c.role === 'button');
    expect(buttons).toHaveLength(2);
    // nodeIds should differ because sibling index differs
    expect(buttons[0]!.nodeId).not.toBe(buttons[1]!.nodeId);
  });

  it('same button in different landmarks gets different nodeId', () => {
    const raw: RawA11yNode = {
      role: 'document',
      name: '',
      children: [
        { role: 'navigation', name: '', children: [{ role: 'link', name: 'Home' }] },
        { role: 'main', name: '', children: [{ role: 'link', name: 'Home' }] },
      ],
    };
    const tree = normalizeA11yTree(raw);
    const nav = tree!.children.find((c) => c.role === 'navigation');
    const main = tree!.children.find((c) => c.role === 'main');
    const navLink = nav!.children[0];
    const mainLink = main!.children[0];
    // Same role+name but different landmark → different fingerprint
    expect(navLink!.nodeId).not.toBe(mainLink!.nodeId);
  });

  it('debug attribute shows fingerprint info', () => {
    const raw: RawA11yNode = {
      role: 'button',
      name: 'Submit',
    };
    const tree = normalizeA11yTree(raw);
    expect(tree).not.toBeNull();
    expect(tree!.attributes['data-fingerprint-debug']).toBeTruthy();
    expect(tree!.attributes['data-legacy-id']).toBeTruthy();
  });
});
