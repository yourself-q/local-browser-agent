import type { Page } from 'playwright';
import type { ActionDecision } from '../../llm/types.js';
import type { GroundedElement } from '../types.js';
import type { DOMSnapshot } from '../../state/dom.js';
import { createLogger } from '../../runtime/logger.js';

const log = createLogger('grounding:dom');

// ─── DOM grounding strategy ───────────────────────────────────────────────────

export interface DOMGroundingResult {
  element?: GroundedElement;
  confidence: number;
  reason?: string;
}

/**
 * Fallback grounding strategy using the DOM element index.
 *
 * When the accessibility tree match fails, search the DOM snapshot for
 * elements whose text / aria-label / placeholder matches the description.
 * Generate a CSS selector and validate it via Playwright.
 */
export async function groundViaDOM(
  decision: ActionDecision,
  domSnapshot: DOMSnapshot,
  page: Page,
): Promise<DOMGroundingResult> {
  const query = String(decision.targetDescription ?? '').toLowerCase().trim();
  if (!query) {
    return { confidence: 0, reason: 'No target description for DOM fallback' };
  }

  // Score all DOM elements
  const scored = domSnapshot.elementIndex
    .map((entry) => {
      const text = (entry.text ?? '').toLowerCase();
      const ariaLabel = (entry.ariaLabel ?? '').toLowerCase();
      const placeholder = (entry.placeholder ?? '').toLowerCase();

      let score = 0;

      if (ariaLabel === query || text === query) score = 1.0;
      else if (ariaLabel.includes(query) || text.includes(query)) score = 0.75;
      else if (placeholder.includes(query)) score = 0.65;
      else if (query.includes(text) && text.length > 2) score = 0.55;

      return { entry, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { confidence: 0, reason: 'No DOM elements matched description' };
  }

  const best = scored[0]!;
  log.debug({ selector: best.entry.selector, score: best.score }, 'DOM match found');

  // Validate via Playwright — try main frame first, then sub-frames
  try {
    let target: import('playwright').Locator | undefined;

    const mainLocator = page.locator(best.entry.selector);
    const mainCount = await mainLocator.count().catch(() => 0);
    if (mainCount > 0) {
      target = mainCount > 1 ? mainLocator.first() : mainLocator;
    } else {
      // Try sub-frames (e.g. LMS quiz pages hosted inside iframes)
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        try {
          const fl = frame.locator(best.entry.selector);
          const fc = await fl.count().catch(() => 0);
          if (fc > 0) {
            target = fc > 1 ? fl.first() : fl;
            log.debug({ frameUrl: frame.url(), selector: best.entry.selector }, 'DOM match in sub-frame');
            break;
          }
        } catch { /* detached frame — skip */ }
      }
    }

    if (!target) {
      return { confidence: 0, reason: 'DOM selector matched nothing in Playwright (all frames)' };
    }
    const isVisible = await target.isVisible().catch(() => false);
    const isEnabled = await target.isEnabled().catch(() => false);
    const boundingBox = await target.boundingBox().catch(() => null);

    const grounded: GroundedElement = {
      nodeId: `dom:${best.entry.selector}`,
      locator: target,
      bounds: boundingBox ?? { x: 0, y: 0, width: 0, height: 0 },
      strategy: 'dom',
      confidence: best.score,
      isVisible,
      isClickable: isVisible && isEnabled,
    };

    return { element: grounded, confidence: best.score };
  } catch (err) {
    log.debug({ err, selector: best.entry.selector }, 'DOM locator failed');
    return { confidence: 0, reason: String(err) };
  }
}
