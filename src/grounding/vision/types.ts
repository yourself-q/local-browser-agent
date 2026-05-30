import type { Rect } from '../../state/types.js';

// ─── VisionProvider interface (Refinement 1) ──────────────────────────────────

/**
 * Abstraction over visual grounding backends.
 * The runtime never depends on a specific vision implementation.
 * Swap providers without touching the grounding engine.
 *
 * Future providers: Qwen-VL, OmniParser, OCR pipeline, external grounding service.
 */
export interface VisionProvider {
  readonly name: string;

  /**
   * Given a base64 PNG screenshot and a natural language description of the
   * target element, return the bounding box of the best match.
   */
  locate(
    screenshotBase64: string,
    description: string,
    hint?: VisionHint,
  ): Promise<VisionGroundingResult>;

  /** Whether this provider is currently available */
  isAvailable(): Promise<boolean>;
}

export interface VisionHint {
  /** Expected role of the target element */
  expectedRole?: string;
  /** Approximate region of the screen to search (0.0–1.0 normalized) */
  searchRegion?: Rect;
}

export interface VisionGroundingResult {
  success: boolean;
  bounds?: Rect;
  confidence?: number;
  provider: string;
  error?: string;
}
