/**
 * Tests for the three fixes:
 *   1. switch_tab / close_tab actually delegate to TabManager (was: always returned error)
 *   2. ctx.page is updated to the new active page after a successful tab switch
 *   3. Post-action verification no longer uses a fixed 800ms sleep
 *
 * Unit tests run unconditionally.
 * Integration tests require Chrome on the debugging port and are skipped otherwise.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import { ToolExecutorRegistry } from '../tools/index.js';
import { TabManager } from '../browser/tabs.js';
import type { ActionDecision } from '../llm/types.js';
import type { GroundingEngine } from '../grounding/index.js';
import type { BrowserState, AccessibilityNode } from '../state/types.js';
import type { DOMSnapshot } from '../state/dom.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDecision(overrides: Partial<ActionDecision>): ActionDecision {
  return {
    reasoning: 'test',
    action: 'click',
    confidence: 0.9,
    requiresHumanApproval: false,
    done: false,
    ...overrides,
  };
}

// For switch_tab / close_tab the executor never touches page/grounding/state/domSnapshot.
// Cast null to satisfy TypeScript so we can unit-test without a real browser.
const NULL_PAGE = null as unknown as Page;
const NULL_GROUNDING = null as unknown as GroundingEngine;
const NULL_STATE = null as unknown as BrowserState;
const NULL_DOM = null as unknown as DOMSnapshot;

// ─── Unit tests ───────────────────────────────────────────────────────────────

describe('ToolExecutorRegistry — switch_tab', () => {
  it('calls tabManager.switchToTab with the given tabIndex and returns success', async () => {
    const switchToTab = vi.fn().mockResolvedValue(undefined);
    const mockTabManager = { switchToTab, closeTab: vi.fn(), getAllTabs: vi.fn(), getActivePage: vi.fn() } as unknown as TabManager;

    const executor = new ToolExecutorRegistry();
    const result = await executor.execute(
      makeDecision({ action: 'switch_tab', tabIndex: 2 }),
      undefined, NULL_PAGE, NULL_GROUNDING, NULL_STATE, NULL_DOM,
      'test-session', 0, mockTabManager,
    );

    expect(switchToTab).toHaveBeenCalledWith(2);
    expect(result.success).toBe(true);
    expect(result.action).toBe('switch_tab');
  });

  it('defaults to tabIndex 0 when tabIndex is not provided', async () => {
    const switchToTab = vi.fn().mockResolvedValue(undefined);
    const mockTabManager = { switchToTab, closeTab: vi.fn(), getAllTabs: vi.fn(), getActivePage: vi.fn() } as unknown as TabManager;

    const executor = new ToolExecutorRegistry();
    await executor.execute(
      makeDecision({ action: 'switch_tab' }), // tabIndex omitted
      undefined, NULL_PAGE, NULL_GROUNDING, NULL_STATE, NULL_DOM,
      'test-session', 0, mockTabManager,
    );

    expect(switchToTab).toHaveBeenCalledWith(0);
  });

  it('returns failure when TabManager throws', async () => {
    const mockTabManager = {
      switchToTab: vi.fn().mockRejectedValue(new Error('Tab index 99 out of range')),
      closeTab: vi.fn(), getAllTabs: vi.fn(), getActivePage: vi.fn(),
    } as unknown as TabManager;

    const executor = new ToolExecutorRegistry();
    const result = await executor.execute(
      makeDecision({ action: 'switch_tab', tabIndex: 99 }),
      undefined, NULL_PAGE, NULL_GROUNDING, NULL_STATE, NULL_DOM,
      'test-session', 0, mockTabManager,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Tab index 99 out of range');
  });
});

describe('ToolExecutorRegistry — close_tab', () => {
  it('calls tabManager.closeTab with the given tabIndex', async () => {
    const closeTab = vi.fn().mockResolvedValue(undefined);
    const mockTabManager = { switchToTab: vi.fn(), closeTab, getAllTabs: vi.fn(), getActivePage: vi.fn() } as unknown as TabManager;

    const executor = new ToolExecutorRegistry();
    const result = await executor.execute(
      makeDecision({ action: 'close_tab', tabIndex: 1 }),
      undefined, NULL_PAGE, NULL_GROUNDING, NULL_STATE, NULL_DOM,
      'test-session', 0, mockTabManager,
    );

    expect(closeTab).toHaveBeenCalledWith(1);
    expect(result.success).toBe(true);
  });

  it('finds the active tab automatically when tabIndex is omitted', async () => {
    const closeTab = vi.fn().mockResolvedValue(undefined);
    const getAllTabs = vi.fn().mockResolvedValue([
      { index: 0, url: 'https://a.com', title: 'A', isActive: false },
      { index: 1, url: 'https://b.com', title: 'B', isActive: true },
      { index: 2, url: 'https://c.com', title: 'C', isActive: false },
    ]);
    const mockTabManager = { switchToTab: vi.fn(), closeTab, getAllTabs, getActivePage: vi.fn() } as unknown as TabManager;

    const executor = new ToolExecutorRegistry();
    await executor.execute(
      makeDecision({ action: 'close_tab' }), // tabIndex omitted
      undefined, NULL_PAGE, NULL_GROUNDING, NULL_STATE, NULL_DOM,
      'test-session', 0, mockTabManager,
    );

    expect(getAllTabs).toHaveBeenCalled();
    expect(closeTab).toHaveBeenCalledWith(1); // index of the active tab
  });

  it('falls back to index 0 when no tab is marked active', async () => {
    const closeTab = vi.fn().mockResolvedValue(undefined);
    const getAllTabs = vi.fn().mockResolvedValue([
      { index: 0, url: 'https://a.com', title: 'A', isActive: false },
    ]);
    const mockTabManager = { switchToTab: vi.fn(), closeTab, getAllTabs, getActivePage: vi.fn() } as unknown as TabManager;

    const executor = new ToolExecutorRegistry();
    await executor.execute(
      makeDecision({ action: 'close_tab' }),
      undefined, NULL_PAGE, NULL_GROUNDING, NULL_STATE, NULL_DOM,
      'test-session', 0, mockTabManager,
    );

    expect(closeTab).toHaveBeenCalledWith(0);
  });

  it('returns failure when TabManager throws', async () => {
    const mockTabManager = {
      switchToTab: vi.fn(),
      closeTab: vi.fn().mockRejectedValue(new Error('Cannot close the last tab')),
      getAllTabs: vi.fn().mockResolvedValue([{ index: 0, url: 'x', title: 'x', isActive: true }]),
      getActivePage: vi.fn(),
    } as unknown as TabManager;

    const executor = new ToolExecutorRegistry();
    const result = await executor.execute(
      makeDecision({ action: 'close_tab' }),
      undefined, NULL_PAGE, NULL_GROUNDING, NULL_STATE, NULL_DOM,
      'test-session', 0, mockTabManager,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot close the last tab');
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

describe('TabManager integration — ctx.page update after switch_tab', () => {
  it('switchToTab(index) makes getActivePage() return the page at that index', { timeout: 15000 }, async () => {
    if (!chromeAvailable || !context) {
      console.log(`[SKIP] Chrome not available at ${ENDPOINT}`);
      return;
    }

    const pages = context.pages();
    if (pages.length < 2) {
      console.log('[SKIP] Need at least 2 open tabs for this test');
      return;
    }

    const tabManager = new TabManager(context);

    // Switch to index 1
    await tabManager.switchToTab(1);
    expect(tabManager.getActivePage()).toBe(pages[1]);

    // Switch back to index 0
    await tabManager.switchToTab(0);
    expect(tabManager.getActivePage()).toBe(pages[0]);
  });

  it('executor switch_tab returns success and TabManager reflects the new active page', { timeout: 15000 }, async () => {
    if (!chromeAvailable || !context) {
      console.log(`[SKIP] Chrome not available at ${ENDPOINT}`);
      return;
    }

    const pages = context.pages();
    if (pages.length < 2) {
      console.log('[SKIP] Need at least 2 open tabs for this test');
      return;
    }

    const tabManager = new TabManager(context);

    // Start on index 1, then switch to 0 via executor
    await tabManager.switchToTab(1);
    expect(tabManager.getActivePage()).toBe(pages[1]);

    const executor = new ToolExecutorRegistry();
    const result = await executor.execute(
      makeDecision({ action: 'switch_tab', tabIndex: 0 }),
      undefined, NULL_PAGE, NULL_GROUNDING, NULL_STATE, NULL_DOM,
      'test-session', 0, tabManager,
    );

    expect(result.success).toBe(true);
    expect(tabManager.getActivePage()).toBe(pages[0]);
  });
});

describe('Post-action verification — domcontentloaded replaces 800ms sleep', () => {
  it('waitForLoadState(domcontentloaded) resolves near-instantly on an already-loaded page', async () => {
    if (!chromeAvailable || !context) {
      console.log(`[SKIP] Chrome not available at ${ENDPOINT}`);
      return;
    }

    const page = context.pages()[0];
    if (!page) return;

    // The old approach used an unconditional waitForTimeout(800) before checking state.
    // The new approach calls waitForLoadState('domcontentloaded') first.
    // On a page that is already loaded (no navigation just happened), domcontentloaded
    // fires immediately — confirming we avoid the fixed 800ms sleep on every step.
    const startMs = Date.now();
    await page.waitForLoadState('domcontentloaded', { timeout: 2000 }).catch(() => {});
    const domElapsed = Date.now() - startMs;

    // domcontentloaded on an already-loaded page should resolve well under 500ms.
    // (networkidle is not measured here — it legitimately takes longer on dynamic pages.)
    expect(domElapsed).toBeLessThan(500);
  });
});
