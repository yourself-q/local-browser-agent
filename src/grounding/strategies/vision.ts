import type { Page } from 'playwright';
import type { ActionDecision } from '../../llm/types.js';
import type { GroundedElement } from '../types.js';
import type { VisionProvider } from '../vision/types.js';
import { createLogger } from '../../runtime/logger.js';

const log = createLogger('grounding:vision');

// ─── Vision grounding adapter (Refinement 1) ──────────────────────────────────

/**
 * This module is a thin adapter. It does NOT implement vision logic.
 * It delegates to a VisionProvider, which can be swapped at runtime.
 * This allows future providers (Qwen-VL, OmniParser, OCR) without
 * changing the grounding engine.
 */

export interface VisionGroundingResult {
  element?: GroundedElement;
  confidence: number;
  reason?: string;
}

export async function groundViaVision(
  decision: ActionDecision,
  page: Page,
  provider: VisionProvider,
): Promise<VisionGroundingResult> {
  const description = String(decision.targetDescription ?? decision.targetElementId ?? '');

  if (!description) {
    return { confidence: 0, reason: 'No description for vision grounding' };
  }

  const available = await provider.isAvailable();
  if (!available) {
    return { confidence: 0, reason: `Vision provider '${provider.name}' is not available` };
  }

  // Capture screenshot for the provider
  let screenshotBase64: string;
  try {
    const buffer = await page.screenshot({ type: 'png', fullPage: false });
    screenshotBase64 = buffer.toString('base64');
  } catch (err) {
    return { confidence: 0, reason: `Screenshot failed: ${String(err)}` };
  }

  log.debug({ provider: provider.name, description }, 'Attempting vision grounding');

  const result = await provider.locate(screenshotBase64, description);

  if (!result.success || !result.bounds) {
    log.debug({ reason: result.error }, 'Vision grounding failed');
    return { confidence: 0, reason: result.error ?? 'Vision provider returned no result' };
  }

  const { x, y, width, height } = result.bounds;
  const centerX = x + width / 2;
  const centerY = y + height / 2;

  // Create a Playwright locator at the computed coordinates
  // This is coordinate-based — flagged explicitly in the GroundedElement
  const locator = page.locator(`xpath=//body`).and(page.locator(':near(:root)'));

  // For coordinate-based clicks, we store bounds and let the executor use page.mouse
  const grounded: GroundedElement = {
    nodeId: `vision:${centerX}x${centerY}`,
    locator,
    bounds: result.bounds,
    strategy: 'vision',
    confidence: result.confidence ?? 0.5,
    isVisible: true,
    isClickable: true,
  };

  log.warn(
    { provider: provider.name, bounds: result.bounds, confidence: result.confidence },
    'Grounded via vision (degraded mode) — coordinate-based click',
  );

  return { element: grounded, confidence: result.confidence ?? 0.5 };
}
