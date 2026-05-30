import type { Page } from 'playwright';
import { captureAccessibilityTree } from './accessibility.js';
import { captureDOMSnapshot } from './dom.js';
import { injectAgentRefs } from './dom-inject.js';
import type { BrowserState, TabInfo } from './types.js';
import { createLogger } from '../runtime/logger.js';

export { diffStates } from './diff.js';
export type { BrowserState, StateDelta, AccessibilityNode, ClickableElement } from './types.js';

const log = createLogger('state');

// ─── State capturer ───────────────────────────────────────────────────────────

export class StateCapturer {
  constructor(
    private readonly sessionId: string,
    private readonly withScreenshot: (step: number) => boolean,
  ) {}

  async capture(page: Page, stepIndex: number): Promise<BrowserState> {
    const startMs = Date.now();

    const [a11yResult, domSnapshot, tabs, focusInfo] = await Promise.all([
      captureAccessibilityTree(page),
      captureDOMSnapshot(page),
      captureTabInfo(page),
      page.evaluate(() => {
        const el = document.activeElement;
        return el && el !== document.body ? el.getAttribute('data-agent-node-id') : null;
      }).catch(() => null),
    ]);

    let screenshot: string | undefined;
    if (this.withScreenshot(stepIndex)) {
      try {
        const buffer = await page.screenshot({ type: 'png', fullPage: false });
        screenshot = buffer.toString('base64');
      } catch (err) {
        log.warn({ err }, 'Screenshot failed');
      }
    }

    const { elements: clickableElements, viewportHeight } = await injectAgentRefs(page);

    const state: BrowserState = {
      sessionId: this.sessionId,
      stepIndex,
      timestamp: Date.now(),
      url: page.url(),
      title: await page.title().catch(() => ''),
      tabs,
      accessibilityTree: a11yResult.tree,
      clickableElements,
      viewportHeight,
      treeHash: a11yResult.treeHash,
      domHash: domSnapshot.hash,
      focusedNodeId: focusInfo ?? undefined,
      screenshot,
    };

    log.debug(
      {
        url: state.url,
        tabs: state.tabs.length,
        interactive: state.clickableElements.length,
        stepMs: Date.now() - startMs,
      },
      'State captured',
    );

    return state;
  }
}

// ─── Tab info helper ──────────────────────────────────────────────────────────

async function captureTabInfo(page: Page): Promise<TabInfo[]> {
  // We can only get the active page here; full tab list is from TabManager
  return [
    {
      index: 0,
      url: page.url(),
      title: await page.title().catch(() => ''),
      isActive: true,
    },
  ];
}
