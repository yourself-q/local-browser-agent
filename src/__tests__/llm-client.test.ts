import { describe, test, expect } from 'vitest';
import { stripThinkingBlocks, mergeConsecutiveMessages, parseDecision } from '../llm/openai.js';
import type OpenAI from 'openai';

// ─── stripThinkingBlocks ──────────────────────────────────────────────────────

describe('stripThinkingBlocks', () => {
  test('strips <think>...</think> block', () => {
    const input = '<think>\nI should click the button.\n</think>\n{"action":"click"}';
    expect(stripThinkingBlocks(input)).toBe('{"action":"click"}');
  });

  test('strips inline <think> block', () => {
    const input = '<think>reasoning</think>{"action":"navigate","value":"https://example.com"}';
    expect(stripThinkingBlocks(input)).toBe('{"action":"navigate","value":"https://example.com"}');
  });

  test('strips <|thinking|>...</|thinking|> variant', () => {
    const input = '<|thinking|>internal thought<|/thinking|>\n{"action":"wait"}';
    expect(stripThinkingBlocks(input)).toBe('{"action":"wait"}');
  });

  test('strips /think suffix', () => {
    const input = '{"action":"done"}/think';
    expect(stripThinkingBlocks(input)).toBe('{"action":"done"}');
  });

  test('strips dangling </think> at start of content', () => {
    // Some models emit a partial close tag before the JSON
    const input = '</think>\n{"action":"click"}';
    expect(stripThinkingBlocks(input)).toBe('{"action":"click"}');
  });

  test('passes through content with no thinking blocks unchanged', () => {
    const input = '{"action":"type","value":"hello"}';
    expect(stripThinkingBlocks(input)).toBe(input);
  });

  test('handles empty string', () => {
    expect(stripThinkingBlocks('')).toBe('');
  });
});

// ─── mergeConsecutiveMessages ─────────────────────────────────────────────────
// This function guards against the Qwen3 Jinja template error:
// "No user query found in messages." — caused by consecutive user messages.

describe('mergeConsecutiveMessages', () => {
  type Msg = OpenAI.Chat.ChatCompletionMessageParam;

  const sys  = (content: string): Msg => ({ role: 'system', content });
  const user = (content: string): Msg => ({ role: 'user', content });
  const asst = (content: string): Msg => ({ role: 'assistant', content });

  test('passes through alternating messages unchanged', () => {
    const msgs: Msg[] = [sys('system'), user('hello'), asst('world'), user('next')];
    const result = mergeConsecutiveMessages(msgs);
    expect(result).toHaveLength(4);
    expect(result[0]!.role).toBe('system');
    expect(result[1]!.role).toBe('user');
    expect(result[2]!.role).toBe('assistant');
    expect(result[3]!.role).toBe('user');
  });

  test('merges consecutive user messages into one', () => {
    const msgs: Msg[] = [sys('system'), user('first'), user('second')];
    const result = mergeConsecutiveMessages(msgs);
    expect(result).toHaveLength(2);
    const merged = result[1] as OpenAI.Chat.ChatCompletionUserMessageParam;
    expect(merged.role).toBe('user');
    // Both texts should be present
    const text = typeof merged.content === 'string'
      ? merged.content
      : merged.content.filter((p) => p.type === 'text').map((p) => (p as { type: 'text'; text: string }).text).join('');
    expect(text).toContain('first');
    expect(text).toContain('second');
  });

  test('merges consecutive assistant messages into one', () => {
    const msgs: Msg[] = [sys('s'), user('u'), asst('part1'), asst('part2')];
    const result = mergeConsecutiveMessages(msgs);
    expect(result).toHaveLength(3);
    const merged = result[2] as OpenAI.Chat.ChatCompletionAssistantMessageParam;
    expect(merged.role).toBe('assistant');
    expect(typeof merged.content).toBe('string');
    expect(merged.content as string).toContain('part1');
    expect(merged.content as string).toContain('part2');
  });

  test('preserves image_url parts when merging user messages', () => {
    const imgMsg: OpenAI.Chat.ChatCompletionUserMessageParam = {
      role: 'user',
      content: [
        { type: 'text', text: 'screenshot:' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } },
      ],
    };
    const textMsg: OpenAI.Chat.ChatCompletionUserMessageParam = {
      role: 'user',
      content: 'next state info',
    };
    const msgs: Msg[] = [sys('s'), imgMsg, textMsg];
    const result = mergeConsecutiveMessages(msgs);
    expect(result).toHaveLength(2);
    const merged = result[1] as OpenAI.Chat.ChatCompletionUserMessageParam;
    const parts = merged.content as OpenAI.Chat.ChatCompletionContentPart[];
    const imageParts = parts.filter((p) => p.type === 'image_url');
    expect(imageParts).toHaveLength(1);
    expect((imageParts[0] as OpenAI.Chat.ChatCompletionContentPartImage).image_url.url).toBe('data:image/png;base64,abc123');
  });

  test('does not merge system messages', () => {
    // Two system messages would be unusual but should not be merged
    const msgs: Msg[] = [sys('s1'), sys('s2'), user('u')];
    const result = mergeConsecutiveMessages(msgs);
    // System messages are passed through as-is (pushed individually)
    expect(result).toHaveLength(3);
  });

  test('handles single message', () => {
    const msgs: Msg[] = [user('only')];
    expect(mergeConsecutiveMessages(msgs)).toHaveLength(1);
  });

  test('handles empty array', () => {
    expect(mergeConsecutiveMessages([])).toHaveLength(0);
  });
});

// ─── parseDecision ────────────────────────────────────────────────────────────
// Three fallback paths: direct JSON → markdown code block → first JSON object in string.

describe('parseDecision', () => {
  const baseDecision = {
    reasoning: 'test',
    action: 'click',
    confidence: 0.9,
    requiresHumanApproval: false,
    done: false,
    error: null,
  };

  test('parses clean JSON directly', () => {
    const input = JSON.stringify(baseDecision);
    const result = parseDecision(input);
    expect(result.action).toBe('click');
    expect(result.reasoning).toBe('test');
  });

  test('extracts JSON from markdown ```json code block', () => {
    const input = '```json\n' + JSON.stringify(baseDecision) + '\n```';
    const result = parseDecision(input);
    expect(result.action).toBe('click');
  });

  test('extracts JSON from plain ``` code block', () => {
    const input = '```\n' + JSON.stringify(baseDecision) + '\n```';
    const result = parseDecision(input);
    expect(result.action).toBe('click');
  });

  test('extracts first JSON object from mixed text', () => {
    const input = 'Here is my response:\n' + JSON.stringify(baseDecision) + '\nEnd.';
    const result = parseDecision(input);
    expect(result.action).toBe('click');
  });

  test('returns fail decision for completely unparseable content', () => {
    const result = parseDecision('this is not json at all');
    expect(result.action).toBe('fail');
    expect(result.confidence).toBe(0);
  });

  test('returns fail decision when schema validation fails (missing required field)', () => {
    // Missing 'reasoning' field
    const input = JSON.stringify({ action: 'click' });
    const result = parseDecision(input);
    expect(result.action).toBe('fail');
  });

  test('handles remember field when present', () => {
    const withRemember = { ...baseDecision, remember: 'Entered email: user@example.com' };
    const result = parseDecision(JSON.stringify(withRemember));
    expect(result.remember).toBe('Entered email: user@example.com');
  });

  test('normalizes null/undefined optional fields', () => {
    const input = JSON.stringify({ ...baseDecision, targetElementId: null, value: null });
    const result = parseDecision(input);
    expect(result.targetElementId).toBeUndefined();
    expect(result.value).toBeUndefined();
  });
});
