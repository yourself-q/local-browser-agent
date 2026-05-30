import { describe, it, expect } from 'vitest';
import { FollowUpActionSchema, ActionDecisionSchema } from '../llm/types.js';

// ─── FollowUpActionSchema ─────────────────────────────────────────────────────

describe('FollowUpActionSchema', () => {
  it('validates a minimal follow-up action (action field only)', () => {
    const result = FollowUpActionSchema.safeParse({ action: 'click' });
    expect(result.success).toBe(true);
  });

  it('validates a complete follow-up action with all relevant fields', () => {
    const result = FollowUpActionSchema.safeParse({
      action: 'type',
      targetElementId: 'ref_3',
      value: 'hello@example.com',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.targetElementId).toBe('ref_3');
      expect(result.data.value).toBe('hello@example.com');
    }
  });

  it('transforms null optional fields to undefined', () => {
    const result = FollowUpActionSchema.safeParse({
      action: 'click',
      targetElementId: null,
      targetDescription: null,
      value: null,
      scrollDirection: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.targetElementId).toBeUndefined();
      expect(result.data.targetDescription).toBeUndefined();
      expect(result.data.value).toBeUndefined();
      expect(result.data.scrollDirection).toBeUndefined();
    }
  });

  it('transforms scrollAmount = 0 to undefined', () => {
    const result = FollowUpActionSchema.safeParse({ action: 'scroll', scrollAmount: 0 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.scrollAmount).toBeUndefined();
  });

  it('transforms scrollAmount = null to undefined', () => {
    const result = FollowUpActionSchema.safeParse({ action: 'scroll', scrollAmount: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.scrollAmount).toBeUndefined();
  });

  it('rounds positive scrollAmount to nearest integer', () => {
    const result = FollowUpActionSchema.safeParse({ action: 'scroll', scrollAmount: 314.9 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.scrollAmount).toBe(315);
  });

  it('rejects an unknown action type', () => {
    const result = FollowUpActionSchema.safeParse({ action: 'fly_away' });
    expect(result.success).toBe(false);
  });
});

// ─── ActionDecisionSchema — nextActions field ─────────────────────────────────

describe('ActionDecisionSchema — nextActions field', () => {
  function baseDecision(overrides: Record<string, unknown> = {}) {
    return {
      reasoning: 'step reasoning',
      action: 'click',
      confidence: 0.9,
      requiresHumanApproval: false,
      done: false,
      ...overrides,
    };
  }

  it('nextActions: null transforms to undefined', () => {
    const result = ActionDecisionSchema.safeParse(baseDecision({ nextActions: null }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.nextActions).toBeUndefined();
  });

  it('nextActions: omitted also resolves to undefined', () => {
    const result = ActionDecisionSchema.safeParse(baseDecision());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.nextActions).toBeUndefined();
  });

  it('nextActions: empty array is valid', () => {
    const result = ActionDecisionSchema.safeParse(baseDecision({ nextActions: [] }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.nextActions).toEqual([]);
  });

  it('nextActions: single follow-up action is accepted', () => {
    const result = ActionDecisionSchema.safeParse(
      baseDecision({
        nextActions: [{ action: 'type', targetElementId: 'ref_5', value: 'hello' }],
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nextActions).toHaveLength(1);
      expect(result.data.nextActions?.[0]?.action).toBe('type');
    }
  });

  it('nextActions: array of exactly 3 is accepted (maximum allowed)', () => {
    const result = ActionDecisionSchema.safeParse(
      baseDecision({
        nextActions: [
          { action: 'click', targetElementId: 'ref_1' },
          { action: 'type', targetElementId: 'ref_2', value: 'abc' },
          { action: 'click', targetElementId: 'ref_3' },
        ],
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.nextActions).toHaveLength(3);
  });

  it('nextActions: array of 4 is rejected (exceeds max 3)', () => {
    const result = ActionDecisionSchema.safeParse(
      baseDecision({
        nextActions: [
          { action: 'click', targetElementId: 'ref_1' },
          { action: 'click', targetElementId: 'ref_2' },
          { action: 'click', targetElementId: 'ref_3' },
          { action: 'click', targetElementId: 'ref_4' },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it('nextActions: invalid follow-up action type fails validation', () => {
    const result = ActionDecisionSchema.safeParse(
      baseDecision({ nextActions: [{ action: 'invalid_action' }] }),
    );
    expect(result.success).toBe(false);
  });

  it('each follow-up is validated through FollowUpActionSchema — null fields become undefined', () => {
    const result = ActionDecisionSchema.safeParse(
      baseDecision({
        nextActions: [{ action: 'type', targetElementId: null, value: null }],
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      const followUp = result.data.nextActions?.[0];
      expect(followUp?.targetElementId).toBeUndefined();
      expect(followUp?.value).toBeUndefined();
    }
  });

  it('follow-up with scroll fields is validated correctly', () => {
    const result = ActionDecisionSchema.safeParse(
      baseDecision({
        nextActions: [{ action: 'scroll', scrollDirection: 'down', scrollAmount: 500 }],
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      const followUp = result.data.nextActions?.[0];
      expect(followUp?.scrollDirection).toBe('down');
      expect(followUp?.scrollAmount).toBe(500);
    }
  });
});
