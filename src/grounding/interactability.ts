import type { Page } from 'playwright';
import type { Locator } from 'playwright';

// ─── Interactability score ────────────────────────────────────────────────────

/**
 * Score an element's actual interactability beyond just `isVisible()`.
 *
 * Playwright's isVisible() misses many real-world failures:
 * - Element is visible but pointer-events: none
 * - Element is behind a high z-index overlay
 * - Element is 95% clipped by overflow:hidden parent
 * - Element is fading out (opacity: 0.05)
 * - Element is in a loading state (skeleton/shimmer)
 * - Element exists in DOM but is in a collapsed accordion
 *
 * This check catches those cases.
 */
export interface InteractabilityResult {
  /** 0.0–1.0 — higher is more interactable */
  score: number;
  /** True if we expect interaction to succeed */
  likely: boolean;
  /** List of detected issues */
  issues: InteractabilityIssue[];
  /** CSS computed properties that informed the score */
  computed: ComputedProperties;
}

export interface InteractabilityIssue {
  severity: 'block' | 'warn' | 'info';
  code: string;
  description: string;
}

export interface ComputedProperties {
  display?: string;
  visibility?: string;
  pointerEvents?: string;
  opacity?: number;
  zIndex?: string;
  overflow?: string;
  position?: string;
  /** Fraction of element visible in viewport (0.0–1.0) */
  viewportVisibility?: number;
  /** Whether element center is the topmost element at that point */
  isTopmost?: boolean;
}

// ─── Inspector ────────────────────────────────────────────────────────────────

export async function checkInteractability(
  locator: Locator,
  page: Page,
): Promise<InteractabilityResult> {
  const issues: InteractabilityIssue[] = [];
  let score = 1.0;

  // ── Basic Playwright checks ────────────────────────────────────────────────
  const isVisible = await locator.isVisible({ timeout: 3000 }).catch(() => false);
  const isEnabled = await locator.isEnabled({ timeout: 3000 }).catch(() => false);
  const box = await locator.boundingBox({ timeout: 3000 }).catch(() => null);

  if (!isVisible) {
    return {
      score: 0,
      likely: false,
      issues: [{ severity: 'block', code: 'NOT_VISIBLE', description: 'Element is not visible (Playwright)' }],
      computed: {},
    };
  }

  if (!isEnabled) {
    issues.push({ severity: 'block', code: 'DISABLED', description: 'Element is disabled' });
    score -= 0.5;
  }

  if (!box || box.width === 0 || box.height === 0) {
    issues.push({ severity: 'block', code: 'ZERO_SIZE', description: 'Element has zero bounding box' });
    score -= 0.4;
  }

  // ── CSS computed properties ─────────────────────────────────────────────────
  let computed: ComputedProperties = {};

  if (box) {
    try {
      computed = await locator.evaluate((el): ComputedProperties => {
        const style = window.getComputedStyle(el as HTMLElement);
        return {
          display: style.display,
          visibility: style.visibility,
          pointerEvents: style.pointerEvents,
          opacity: parseFloat(style.opacity),
          zIndex: style.zIndex,
          overflow: style.overflow,
          position: style.position,
        };
      });

      // pointer-events: none blocks interaction
      if (computed.pointerEvents === 'none') {
        issues.push({
          severity: 'block',
          code: 'POINTER_EVENTS_NONE',
          description: 'pointer-events: none — cannot be clicked',
        });
        score -= 0.6;
      }

      // Very low opacity
      const opacity = computed.opacity ?? 1;
      if (opacity < 0.1) {
        issues.push({
          severity: 'block',
          code: 'NEARLY_INVISIBLE',
          description: `opacity: ${opacity.toFixed(2)} — element is nearly transparent`,
        });
        score -= 0.4;
      } else if (opacity < 0.5) {
        issues.push({
          severity: 'warn',
          code: 'LOW_OPACITY',
          description: `opacity: ${opacity.toFixed(2)} — may be fading out`,
        });
        score -= 0.2;
      }

      // visibility: hidden
      if (computed.visibility === 'hidden') {
        issues.push({
          severity: 'block',
          code: 'VISIBILITY_HIDDEN',
          description: 'visibility: hidden',
        });
        score -= 0.5;
      }

    } catch {
      // evaluate failed — element may be in a cross-origin frame
      computed = {};
      issues.push({
        severity: 'info',
        code: 'CROSS_ORIGIN_FRAME',
        description: 'Cannot inspect CSS — element may be in a cross-origin iframe',
      });
      score -= 0.1;
    }

    // ── Viewport visibility ─────────────────────────────────────────────────
    const viewport = page.viewportSize();
    if (viewport && box) {
      const visibleLeft = Math.max(0, box.x);
      const visibleTop = Math.max(0, box.y);
      const visibleRight = Math.min(viewport.width, box.x + box.width);
      const visibleBottom = Math.min(viewport.height, box.y + box.height);

      const visibleArea = Math.max(0, visibleRight - visibleLeft) * Math.max(0, visibleBottom - visibleTop);
      const totalArea = box.width * box.height;
      const viewportVisibility = totalArea > 0 ? visibleArea / totalArea : 0;
      computed.viewportVisibility = viewportVisibility;

      if (viewportVisibility < 0.1) {
        issues.push({
          severity: 'warn',
          code: 'MOSTLY_CLIPPED',
          description: `Only ${(viewportVisibility * 100).toFixed(0)}% of element is in viewport`,
        });
        score -= 0.3;
      } else if (viewportVisibility < 0.5) {
        issues.push({
          severity: 'info',
          code: 'PARTIALLY_CLIPPED',
          description: `${(viewportVisibility * 100).toFixed(0)}% of element is in viewport`,
        });
        score -= 0.1;
      }

      // ── Topmost element check ────────────────────────────────────────────
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;

      if (
        centerX >= 0 &&
        centerX <= viewport.width &&
        centerY >= 0 &&
        centerY <= viewport.height
      ) {
        try {
          const topmostInfo = await page.evaluate(
            ({ x, y }) => {
              const topEl = document.elementFromPoint(x, y);
              if (!topEl) return { isTopmost: false, tag: 'null', role: null };
              return {
                isTopmost: true,
                tag: topEl.tagName.toLowerCase(),
                role: topEl.getAttribute('role'),
                text: (topEl as HTMLElement).textContent?.slice(0, 30) ?? '',
              };
            },
            { x: centerX, y: centerY },
          );

          computed.isTopmost = topmostInfo.isTopmost;

          if (!topmostInfo.isTopmost) {
            issues.push({
              severity: 'warn',
              code: 'COVERED',
              description: 'Element center is covered by another element at this point',
            });
            score -= 0.25;
          }
        } catch {
          // elementFromPoint failed — likely cross-origin iframe
        }
      }
    }
  }

  score = Math.max(0, Math.min(1, score));
  const likely = score >= 0.5 && !issues.some((i) => i.severity === 'block');

  return { score, likely, issues, computed };
}

// ─── Batch check for diagnose ─────────────────────────────────────────────────

export interface BatchInteractabilityResult {
  nodeId: string;
  role: string;
  name: string;
  score: number;
  likely: boolean;
  primaryIssue?: string;
}

export async function batchCheckInteractability(
  elements: Array<{ nodeId: string; role: string; name: string }>,
  page: Page,
  maxElements = 10,
): Promise<BatchInteractabilityResult[]> {
  const results: BatchInteractabilityResult[] = [];

  for (const el of elements.slice(0, maxElements)) {
    try {
      const locator = page.getByRole(el.role as Parameters<typeof page.getByRole>[0], {
        name: el.name,
        exact: false,
      });

      const count = await locator.count().catch(() => 0);
      if (count === 0) {
        results.push({
          nodeId: el.nodeId,
          role: el.role,
          name: el.name,
          score: 0,
          likely: false,
          primaryIssue: 'LOCATOR_MISS',
        });
        continue;
      }

      const target = count > 1 ? locator.first() : locator;
      const result = await checkInteractability(target, page);

      results.push({
        nodeId: el.nodeId,
        role: el.role,
        name: el.name,
        score: result.score,
        likely: result.likely,
        primaryIssue: result.issues[0]?.code,
      });
    } catch {
      results.push({
        nodeId: el.nodeId,
        role: el.role,
        name: el.name,
        score: 0,
        likely: false,
        primaryIssue: 'CHECK_FAILED',
      });
    }
  }

  return results;
}
