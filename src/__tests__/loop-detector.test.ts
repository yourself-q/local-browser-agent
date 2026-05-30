import { describe, it, expect } from 'vitest';
import { ActionLoopDetector } from '../agent/loop-detector.js';

describe('ActionLoopDetector', () => {
  describe('detect()', () => {
    it('returns looping:false when history is empty', () => {
      const d = new ActionLoopDetector();
      expect(d.detect()).toEqual({ looping: false, description: '' });
    });

    it('returns looping:false when fewer than THRESHOLD (3) entries recorded', () => {
      const d = new ActionLoopDetector();
      d.record('click', 'btn-a');
      d.record('click', 'btn-a');
      expect(d.detect().looping).toBe(false);
    });

    it('triggers looping at exactly THRESHOLD (3) identical (action, target) pairs', () => {
      const d = new ActionLoopDetector();
      d.record('click', 'btn-a');
      d.record('click', 'btn-a');
      d.record('click', 'btn-a');
      expect(d.detect().looping).toBe(true);
    });

    it('description includes the action name, target, and count', () => {
      const d = new ActionLoopDetector();
      for (let i = 0; i < 4; i++) d.record('type', 'search-box');
      const { description } = d.detect();
      expect(description).toContain('"type"');
      expect(description).toContain('"search-box"');
      expect(description).toContain('4×');
    });

    it('does not trigger when all (action, target) pairs are distinct', () => {
      const d = new ActionLoopDetector();
      d.record('click', 'btn-a');
      d.record('click', 'btn-b');
      d.record('click', 'btn-c');
      d.record('type', 'btn-a');
      d.record('scroll', 'btn-a');
      expect(d.detect().looping).toBe(false);
    });

    it('counts action+target as a composite key — same action on different targets does not loop', () => {
      const d = new ActionLoopDetector();
      d.record('click', 'btn-a');
      d.record('click', 'btn-b');
      d.record('click', 'btn-c');
      expect(d.detect().looping).toBe(false);
    });

    it('treats undefined target as empty string — three navigate(undefined) triggers loop', () => {
      const d = new ActionLoopDetector();
      d.record('navigate', undefined);
      d.record('navigate', undefined);
      d.record('navigate', undefined);
      expect(d.detect().looping).toBe(true);
    });

    it('evicts oldest entry when window exceeds WINDOW_SIZE (10) — old loop clears once evicted', () => {
      const d = new ActionLoopDetector();
      d.record('click', 'sticky-btn');
      d.record('click', 'sticky-btn');
      d.record('click', 'sticky-btn');
      expect(d.detect().looping).toBe(true);

      // Flood with 10 unique entries to push all sticky-btn records out of the window
      for (let i = 0; i < 10; i++) {
        d.record('click', `unique-target-${i}`);
      }
      expect(d.detect().looping).toBe(false);
    });

    it('window keeps only the last 10 entries — first of 3x btn-a is evicted after 8 more btn-b entries', () => {
      const d = new ActionLoopDetector();
      // 3x btn-a, then 8x btn-b  (total 11 → oldest btn-a shifts off)
      d.record('click', 'btn-a');
      d.record('click', 'btn-a');
      d.record('click', 'btn-a');
      for (let i = 0; i < 8; i++) d.record('click', 'btn-b');
      // Window = [btn-a×2, btn-b×8] — first btn-a was evicted
      const result = d.detect();
      expect(result.looping).toBe(true);
      // btn-b (8 times) should be the reported loop, not btn-a (2 times)
      expect(result.description).toContain('"btn-b"');
    });
  });

  describe('reset()', () => {
    it('clears history so detect() returns looping:false', () => {
      const d = new ActionLoopDetector();
      d.record('click', 'btn');
      d.record('click', 'btn');
      d.record('click', 'btn');
      expect(d.detect().looping).toBe(true);

      d.reset();
      expect(d.detect()).toEqual({ looping: false, description: '' });
    });

    it('accumulates fresh history after reset — 2 records after reset are below threshold', () => {
      const d = new ActionLoopDetector();
      d.record('click', 'btn');
      d.record('click', 'btn');
      d.reset();
      d.record('click', 'btn');
      d.record('click', 'btn');
      expect(d.detect().looping).toBe(false);
    });
  });
});
