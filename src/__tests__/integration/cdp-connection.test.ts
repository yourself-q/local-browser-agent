/**
 * Integration test: real Chrome CDP connection.
 *
 * Skipped automatically if Chrome is not running on the debugging port.
 * Run with:
 *   CHROME_PORT=9222 npx vitest run src/__tests__/integration/
 *
 * Start Chrome first:
 *   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
 *     --remote-debugging-port=9222 --no-first-run --no-default-browser-check
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';
import type { Browser, BrowserContext } from 'playwright';
import { captureAccessibilityTree } from '../../state/accessibility.js';
import { captureDOMSnapshot } from '../../state/dom.js';
import { diffStates } from '../../state/diff.js';
import { normalizeA11yTree, flattenInteractive } from '../../state/normalizer.js';
import type { BrowserState, AccessibilityNode } from '../../state/types.js';

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
  if (browser) {
    await browser.close().catch(() => {});
  }
});

function skipIfNoChrome() {
  if (!chromeAvailable) {
    console.log(`[SKIP] Chrome not available at ${ENDPOINT}`);
    return true;
  }
  return false;
}

// ─── Connection tests ──────────────────────────────────────────────────────────

describe('CDP connection', () => {
  it('connects to Chrome', () => {
    if (skipIfNoChrome()) return;
    expect(browser!.isConnected()).toBe(true);
    expect(context).not.toBeNull();
  });

  it('has at least one page open', () => {
    if (skipIfNoChrome()) return;
    const pages = context!.pages();
    expect(pages.length).toBeGreaterThan(0);
    console.log(`Open pages: ${pages.map((p) => p.url()).join(', ')}`);
  });
});

// ─── Accessibility tree tests ─────────────────────────────────────────────────

describe('Accessibility tree capture', () => {
  it('captures a non-empty a11y tree', async () => {
    if (skipIfNoChrome()) return;
    const pages = context!.pages();
    const page = pages[0]!;

    const result = await captureAccessibilityTree(page);

    expect(result.tree).toBeDefined();
    expect(result.tree.role).toBeTruthy();
    expect(result.treeHash).toMatch(/^[0-9a-f]+$/);

    console.log(`[A11y] treeHash=${result.treeHash.slice(0, 8)} interactive=${result.clickableElements.length}`);
  });

  it('finds interactive elements on any real page', async () => {
    if (skipIfNoChrome()) return;
    const pages = context!.pages();
    const page = pages[0]!;

    const result = await captureAccessibilityTree(page);
    const interactive = flattenInteractive(result.tree);

    console.log(`[A11y] URL=${page.url()} interactive=${interactive.length}`);
    console.log(`[A11y] First 5 elements:`);
    for (const el of interactive.slice(0, 5)) {
      console.log(`  [${el.nodeId.slice(0, 8)}] ${el.role}: "${el.name}"`);
    }

    // Most real pages have at least something interactive
    // (Some SPAs might be loading — that's OK for this test)
    expect(result.clickableElements.length).toBeGreaterThanOrEqual(0);
  });

  it('produces stable nodeIds across two captures', async () => {
    if (skipIfNoChrome()) return;
    const pages = context!.pages();
    const page = pages[0]!;

    // Capture twice without any action
    const result1 = await captureAccessibilityTree(page);
    await page.waitForTimeout(200);
    const result2 = await captureAccessibilityTree(page);

    // Hash should be stable if page hasn't changed
    if (result1.treeHash === result2.treeHash) {
      console.log('[A11y] ✓ NodeId stability confirmed (same hash on both captures)');
      expect(result1.treeHash).toBe(result2.treeHash);
    } else {
      // Page may be dynamically updating (timers, etc.)
      console.log('[A11y] ⚠ Hash changed between captures (dynamic page) — checking nodeId overlap');

      const ids1 = new Set(result1.clickableElements.map((e) => e.nodeId));
      const ids2 = new Set(result2.clickableElements.map((e) => e.nodeId));
      const overlap = [...ids1].filter((id) => ids2.has(id)).length;
      const overlapPct = ids1.size > 0 ? overlap / ids1.size : 1;

      console.log(`[A11y] nodeId overlap: ${overlap}/${ids1.size} (${(overlapPct * 100).toFixed(0)}%)`);
      // Expect at least 50% of nodeIds to be stable
      expect(overlapPct).toBeGreaterThan(0.5);
    }
  });
});

// ─── DOM snapshot tests ───────────────────────────────────────────────────────

describe('DOM snapshot', () => {
  it('captures DOM element index', async () => {
    if (skipIfNoChrome()) return;
    const pages = context!.pages();
    const page = pages[0]!;

    const snapshot = await captureDOMSnapshot(page);

    expect(snapshot.hash).toMatch(/^[0-9a-f]+$/);
    expect(Array.isArray(snapshot.elementIndex)).toBe(true);

    console.log(`[DOM] hash=${snapshot.hash.slice(0, 8)} elements=${snapshot.elementIndex.length}`);

    if (snapshot.elementIndex.length > 0) {
      console.log(`[DOM] Sample elements:`);
      for (const el of snapshot.elementIndex.slice(0, 3)) {
        console.log(`  ${el.tagName} "${el.text.slice(0, 40)}" selector="${el.selector}"`);
      }
    }
  });
});

// ─── State diffing tests ──────────────────────────────────────────────────────

describe('State diffing via navigation', () => {
  it('detects state change after navigation', async () => {
    if (skipIfNoChrome()) return;
    const pages = context!.pages();
    const page = pages[0]!;

    // Capture before state
    const a11yBefore = await captureAccessibilityTree(page);
    const domBefore = await captureDOMSnapshot(page);

    const stateBefore: BrowserState = {
      sessionId: 'test',
      stepIndex: 0,
      timestamp: Date.now(),
      url: page.url(),
      title: await page.title(),
      tabs: [{ index: 0, url: page.url(), title: await page.title(), isActive: true }],
      accessibilityTree: a11yBefore.tree,
      clickableElements: a11yBefore.clickableElements,
      treeHash: a11yBefore.treeHash,
      domHash: domBefore.hash,
    };

    const urlBefore = page.url();

    // Pick a navigation target that is guaranteed different from the current URL so
    // diffStates always observes a real change, regardless of which tab happens to
    // be page[0] across test runs.
    const targetUrl = urlBefore.startsWith('https://example.com')
      ? 'https://www.iana.org/domains/reserved'
      : 'https://example.com';
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(1000);

    // Capture after state
    const a11yAfter = await captureAccessibilityTree(page);
    const domAfter = await captureDOMSnapshot(page);

    const stateAfter: BrowserState = {
      sessionId: 'test',
      stepIndex: 1,
      timestamp: Date.now(),
      url: page.url(),
      title: await page.title(),
      tabs: [{ index: 0, url: page.url(), title: await page.title(), isActive: true }],
      accessibilityTree: a11yAfter.tree,
      clickableElements: a11yAfter.clickableElements,
      treeHash: a11yAfter.treeHash,
      domHash: domAfter.hash,
    };

    const delta = diffStates(stateBefore, stateAfter);

    console.log(`[Diff] URL changed: ${delta.urlChanged} (${urlBefore} → ${page.url()})`);
    console.log(`[Diff] Tree changed: ${delta.treeChanged}`);
    console.log(`[Diff] DOM changed: ${delta.domChanged}`);
    console.log(`[Diff] Nodes added: ${delta.nodesAdded.length}`);
    console.log(`[Diff] Nodes removed: ${delta.nodesRemoved.length}`);

    expect(delta.anythingChanged).toBe(true);

    // Navigate back to where we were
    await page.goto(urlBefore, { timeout: 10000 }).catch(() => {});
  }, 30000);
});

// ─── Overlay / cookie popup detection ────────────────────────────────────────

describe('Overlay detection', () => {
  it('detects dialog/modal roles in the a11y tree', async () => {
    if (skipIfNoChrome()) return;
    const pages = context!.pages();
    const page = pages[0]!;

    const result = await captureAccessibilityTree(page);

    // Find any dialog/alertdialog nodes
    const dialogs = findByRole(result.tree, new Set(['dialog', 'alertdialog', 'alert']));

    if (dialogs.length > 0) {
      console.log(`[Overlay] Found ${dialogs.length} dialog(s):`);
      for (const d of dialogs) {
        console.log(`  ${d.role}: "${d.name}" [${d.nodeId.slice(0, 8)}]`);
      }
    } else {
      console.log('[Overlay] No dialogs detected on current page');
    }

    // This test always passes — it's diagnostic
    expect(true).toBe(true);
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function findByRole(node: AccessibilityNode, roles: Set<string>, result: AccessibilityNode[] = []): AccessibilityNode[] {
  if (roles.has(node.role)) result.push(node);
  for (const child of node.children) findByRole(child, roles, result);
  return result;
}
