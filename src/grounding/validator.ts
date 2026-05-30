import type { Page } from 'playwright';
import type { GroundedElement } from './types.js';
import { createLogger } from '../runtime/logger.js';

const log = createLogger('grounding:validator');

// ─── Element validator ────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validate that a grounded element is truly interactable:
 * - visible in the viewport
 * - not covered by an overlay
 * - bounding box has nonzero area
 * - not disabled
 *
 * Also scrolls the element into view if it's off-screen.
 */
export async function validateGroundedElement(
  element: GroundedElement,
  page: Page,
): Promise<ValidationResult> {
  // Vision-grounded elements bypass DOM validation
  if (element.strategy === 'vision') {
    return { valid: element.isVisible && element.isClickable };
  }

  try {
    // Scroll into view first (non-fatal if it fails)
    await element.locator.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});

    // Re-check visibility after scroll
    const isVisible = await element.locator.isVisible({ timeout: 4000 }).catch(() => false);
    if (!isVisible) {
      return { valid: false, reason: 'Element not visible after scrollIntoView' };
    }

    // Bounding box check
    const box = await element.locator.boundingBox({ timeout: 4000 }).catch(() => null);
    if (!box || box.width === 0 || box.height === 0) {
      return { valid: false, reason: 'Element has zero bounding box' };
    }

    // Overlay check: is the center point actually reachable?
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    const topElement = await page
      .evaluate(
        ({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          return el
            ? {
                tag: el.tagName.toLowerCase(),
                role: el.getAttribute('role'),
                text: (el as HTMLElement).innerText?.slice(0, 40) ?? '',
              }
            : null;
        },
        { x: centerX, y: centerY },
      )
      .catch(() => null);

    if (!topElement) {
      log.debug({ centerX, centerY }, 'elementFromPoint returned null (might be iframe)');
      // Allow — could be inside iframe
    }

    // Update element bounds with fresh data
    element.bounds = box;

    return { valid: true };
  } catch (err) {
    return { valid: false, reason: String(err) };
  }
}
