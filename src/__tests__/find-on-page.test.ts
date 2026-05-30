/**
 * Tests for FindOnPageTool.
 *
 * Unit tests mock page.evaluate() so no browser is needed.
 * Integration tests connect to real Chrome and are skipped if unavailable.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import { FindOnPageTool } from '../tools/primitives/find-on-page.js';
import type { ToolContext } from '../tools/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(pageText: string): ToolContext {
  return {
    page: {
      evaluate: vi.fn().mockResolvedValue(pageText),
    } as unknown as Page,
    sessionId: 'test',
    stepIndex: 0,
  };
}

// ─── Unit tests ───────────────────────────────────────────────────────────────

describe('FindOnPageTool — unit', () => {
  it('returns error for empty pattern', async () => {
    const result = await FindOnPageTool.execute({ pattern: '' }, makeCtx('hello world'));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/empty/i);
  });

  it('returns error for whitespace-only pattern', async () => {
    const result = await FindOnPageTool.execute({ pattern: '   ' }, makeCtx('hello world'));
    expect(result.success).toBe(false);
  });

  it('finds plain text match (case-insensitive)', async () => {
    const ctx = makeCtx('The quick brown fox jumps over the lazy dog');
    const result = await FindOnPageTool.execute({ pattern: 'QUICK BROWN' }, ctx);
    expect(result.success).toBe(true);
    expect(String(result.output)).toContain('quick brown');
    expect(String(result.output)).toContain('Found 1 match');
  });

  it('escapes regex special chars in plain text mode — dot is treated as literal', async () => {
    // "9.99" as plain text should match "9.99" but NOT "9X99"
    const ctx = makeCtx('price: 9.99 dollars\nprice: 9X99 dollars');
    const result = await FindOnPageTool.execute({ pattern: '9.99' }, ctx);
    expect(result.success).toBe(true);
    expect(String(result.output)).toContain('Found 1 match');
  });

  it('returns "No matches found" message when pattern is absent from page', async () => {
    const ctx = makeCtx('hello world');
    const result = await FindOnPageTool.execute({ pattern: 'xyzzy' }, ctx);
    expect(result.success).toBe(true);
    expect(String(result.output)).toContain('No matches found');
  });

  it('supports /regex/flags syntax — /\\d{5}/ matches 5-digit numbers only', async () => {
    const ctx = makeCtx('Order: 12345\nOrder: 67890\nOrder: ABCDE');
    const result = await FindOnPageTool.execute({ pattern: '/\\d{5}/' }, ctx);
    expect(result.success).toBe(true);
    // Matches "12345" and "67890" but not "ABCDE"
    expect(String(result.output)).toContain('Found 2 match');
  });

  it('returns error for an invalid regex pattern', async () => {
    const ctx = makeCtx('hello world');
    const result = await FindOnPageTool.execute({ pattern: '/[invalid/' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid regex/i);
  });

  it('limits results to the default maxMatches (10) when more matches exist', async () => {
    const text = Array.from({ length: 15 }, (_, i) => `line ${i}: target word`).join('\n');
    const result = await FindOnPageTool.execute({ pattern: 'target' }, makeCtx(text));
    expect(result.success).toBe(true);
    expect(String(result.output)).toContain('Found 10 match');
  });

  it('respects a custom maxMatches value', async () => {
    const text = Array.from({ length: 10 }, (_, i) => `line ${i}: token`).join('\n');
    const result = await FindOnPageTool.execute({ pattern: 'token', maxMatches: 3 }, makeCtx(text));
    expect(result.success).toBe(true);
    expect(String(result.output)).toContain('Found 3 match');
  });

  it('surrounds match with surrounding context clipped to contextChars characters', async () => {
    const prefix = 'A'.repeat(200);
    const suffix = 'B'.repeat(200);
    const ctx = makeCtx(`${prefix}NEEDLE${suffix}`);
    const result = await FindOnPageTool.execute({ pattern: 'NEEDLE', contextChars: 50 }, ctx);
    expect(result.success).toBe(true);
    const output = String(result.output);
    expect(output).toContain('NEEDLE');
    // Context window (50+6+50) is well under the 200-char prefix
    const matchLine = output.split('\n').find((l) => l.includes('NEEDLE')) ?? '';
    expect(matchLine.length).toBeLessThan(200);
  });
});

// ─── Integration tests (require Chrome) ──────────────────────────────────────

const CHROME_PORT = parseInt(process.env['CHROME_PORT'] ?? '9222', 10);
const ENDPOINT = `http://localhost:${CHROME_PORT}`;

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let chromeAvailable = false;

beforeAll(async () => {
  try {
    browser = await chromium.connectOverCDP(ENDPOINT, { timeout: 3000 });
    const contexts = browser.contexts();
    context = contexts[0] ?? null;
    chromeAvailable = !!context;
  } catch {
    chromeAvailable = false;
  }
});

afterAll(async () => {
  if (browser) await browser.close().catch(() => {});
});

describe('FindOnPageTool — integration', () => {
  it('finds known text on a real Chrome page', { timeout: 15000 }, async () => {
    if (!chromeAvailable || !context) {
      console.log(`[SKIP] Chrome not available at ${ENDPOINT}`);
      return;
    }
    const page = context.pages()[0];
    if (!page) return;

    await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });

    const ctx: ToolContext = { page, sessionId: 'test', stepIndex: 0 };
    const result = await FindOnPageTool.execute({ pattern: 'Example Domain' }, ctx);

    expect(result.success).toBe(true);
    const output = String(result.output);
    expect(output).toContain('Example Domain');
    expect(output).not.toContain('No matches found');
  });

  it('returns no matches for text that does not exist on the page', { timeout: 15000 }, async () => {
    if (!chromeAvailable || !context) {
      console.log(`[SKIP] Chrome not available at ${ENDPOINT}`);
      return;
    }
    const page = context.pages()[0];
    if (!page) return;

    // Page is already on example.com from the previous test
    const ctx: ToolContext = { page, sessionId: 'test', stepIndex: 0 };
    const result = await FindOnPageTool.execute({ pattern: 'xyzzy_not_on_page_12345' }, ctx);

    expect(result.success).toBe(true);
    expect(String(result.output)).toContain('No matches found');
  });
});
