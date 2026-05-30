import type { Locator } from 'playwright';
import type { Rect } from '../state/types.js';

// ─── Grounding strategy discriminator ────────────────────────────────────────

export type GroundingStrategy = 'a11y' | 'dom' | 'vision';

// ─── Grounded element ─────────────────────────────────────────────────────────

export interface GroundedElement {
  /** A11y nodeId that was matched */
  nodeId: string;
  /** Playwright Locator pointing to the element — ready to use */
  locator: Locator;
  /** Viewport-relative bounding box at time of grounding */
  bounds: Rect;
  /** Which strategy successfully resolved the element */
  strategy: GroundingStrategy;
  /** 0.0–1.0 confidence in the match */
  confidence: number;
  isVisible: boolean;
  isClickable: boolean;
}

// ─── Grounding result ─────────────────────────────────────────────────────────

export interface GroundingResult {
  success: boolean;
  element?: GroundedElement;
  /** Human-readable reason for failure */
  failureReason?: string;
  /** List of strategies attempted in order */
  strategiesAttempted: GroundingStrategy[];
  /** Latency per strategy in ms */
  strategyTimings: Partial<Record<GroundingStrategy, number>>;
}
