/**
 * Integration test: temporal stability and interactability scoring.
 * Requires Chrome on remote debugging port.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';
import type { Browser, BrowserContext } from 'playwright';
import { analyzeTemporalStability } from '../../state/stability.js';
import { batchCheckInteractability } from '../../grounding/interactability.js';
import { captureAccessibilityTree } from '../../state/accessibility.js';
import { flattenInteractive } from '../../state/normalizer.js';

const ENDPOINT = `http://localhost:${process.env['CHROME_PORT'] ?? '9222'}`;
let browser: Browser | null = null;
let context: BrowserContext | null = null;
let available = false;

beforeAll(async () => {
  try {
    browser = await chromium.connectOverCDP(ENDPOINT, { timeout: 3000 });
    context = browser.contexts()[0] ?? null;
    available = !!context;
  } catch {
    available = false;
  }
});

afterAll(async () => {
  if (browser) await browser.close().catch(() => {});
});

function skip() {
  if (!available) console.log(`[SKIP] Chrome not at ${ENDPOINT}`);
  return !available;
}

describe('Temporal stability', () => {
  it('produces stability result within expected range', async () => {
    if (skip()) return;
    const page = context!.pages()[0]!;
    const result = await analyzeTemporalStability(page, [0, 300, 800]);

    expect(result.overallStability).toBeGreaterThanOrEqual(0);
    expect(result.overallStability).toBeLessThanOrEqual(1);
    expect(result.captures).toHaveLength(3);
    expect(result.recommendation).toBeTruthy();

    console.log(`[Stability] overall=${(result.overallStability * 100).toFixed(1)}%`);
    console.log(`[Stability] overlap12=${(result.nodeIdOverlap12 * 100).toFixed(1)}% overlap23=${(result.nodeIdOverlap23 * 100).toFixed(1)}%`);
    console.log(`[Stability] churning=${result.churningNodes.length}`);
    console.log(`[Stability] ${result.recommendation}`);
  }, 10000);
});

describe('Interactability scoring', () => {
  it('scores interactive elements', async () => {
    if (skip()) return;
    const page = context!.pages()[0]!;

    const a11y = await captureAccessibilityTree(page);
    const interactive = flattenInteractive(a11y.tree);

    if (interactive.length === 0) {
      console.log('[Interactability] No interactive elements on page');
      return;
    }

    const results = await batchCheckInteractability(
      interactive.slice(0, 5).map((el) => ({
        nodeId: el.nodeId,
        role: el.role,
        name: el.name,
      })),
      page,
      5,
    );

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
      console.log(`[Interactability] ${r.role} "${r.name.slice(0, 30)}" score=${(r.score * 100).toFixed(0)}% likely=${r.likely} issue=${r.primaryIssue ?? 'none'}`);
    }
  }, 15000);

  it('gives score=0 for non-existent element', async () => {
    if (skip()) return;
    const page = context!.pages()[0]!;

    const results = await batchCheckInteractability(
      [{ nodeId: 'fake-id', role: 'button', name: 'DOES_NOT_EXIST_EVER_12345678' }],
      page,
      1,
    );

    expect(results[0]!.score).toBe(0);
    expect(results[0]!.likely).toBe(false);
    expect(results[0]!.primaryIssue).toBe('LOCATOR_MISS');
  });
});
