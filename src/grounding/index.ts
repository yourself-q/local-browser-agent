import type { Page } from 'playwright';
import type { BrowserState } from '../state/types.js';
import type { ActionDecision } from '../llm/types.js';
import type { GroundingResult, GroundingStrategy } from './types.js';
import type { VisionProvider } from './vision/types.js';
import type { DOMSnapshot } from '../state/dom.js';
import { groundViaA11y } from './strategies/a11y.js';
import { groundViaDOM } from './strategies/dom.js';
import { groundViaVision } from './strategies/vision.js';
import { validateGroundedElement } from './validator.js';
import { createLogger } from '../runtime/logger.js';

export type { GroundingResult, GroundedElement, GroundingStrategy } from './types.js';
export type { VisionProvider } from './vision/types.js';

const log = createLogger('grounding');

// ─── Grounding engine ─────────────────────────────────────────────────────────

export class GroundingEngine {
  /**
   * Vision grounding requires a full LLM round-trip (screenshot → bounding box prediction).
   * For a local Qwen3-35B this takes 30–60 seconds per call.
   * Cap at 3 per session: if vision is exhausted, surface a clear error so the LLM
   * can fall back to execute_javascript instead of waiting for another slow call.
   */
  private visionCallsUsed = 0;
  private readonly visionBudget = 3;

  constructor(private readonly visionProvider: VisionProvider) {}

  /**
   * Resolve an LLM action decision to a grounded, validated Playwright element.
   *
   * Tries strategies in order: a11y → dom → vision.
   * Each strategy is timed and recorded in the result for observability.
   */
  async resolve(
    decision: ActionDecision,
    state: BrowserState,
    domSnapshot: DOMSnapshot,
    page: Page,
  ): Promise<GroundingResult> {
    const strategiesAttempted: GroundingStrategy[] = [];
    const strategyTimings: Partial<Record<GroundingStrategy, number>> = {};

    // ── Strategy 1: Accessibility tree ──────────────────────────────────────
    {
      const start = Date.now();
      strategiesAttempted.push('a11y');
      const result = await groundViaA11y(decision, state, page);
      strategyTimings['a11y'] = Date.now() - start;

      if (result.element) {
        const validation = await validateGroundedElement(result.element, page);
        if (validation.valid) {
          log.debug(
            { strategy: 'a11y', nodeId: result.element.nodeId, confidence: result.confidence },
            'Grounded via a11y',
          );
          return {
            success: true,
            element: result.element,
            strategiesAttempted,
            strategyTimings,
          };
        }
        log.debug({ reason: validation.reason }, 'A11y element failed validation');
      }
    }

    // ── Strategy 2: DOM snapshot ──────────────────────────────────────────────
    {
      const start = Date.now();
      strategiesAttempted.push('dom');
      const result = await groundViaDOM(decision, domSnapshot, page);
      strategyTimings['dom'] = Date.now() - start;

      if (result.element) {
        const validation = await validateGroundedElement(result.element, page);
        if (validation.valid) {
          log.debug(
            { strategy: 'dom', selector: result.element.nodeId, confidence: result.confidence },
            'Grounded via DOM',
          );
          return {
            success: true,
            element: result.element,
            strategiesAttempted,
            strategyTimings,
          };
        }
        log.debug({ reason: validation.reason }, 'DOM element failed validation');
      }
    }

    // ── Strategy 3: Vision (last resort, budget-capped) ──────────────────────
    if (this.visionCallsUsed >= this.visionBudget) {
      // Budget exhausted — skip vision and surface a helpful error.
      // The LLM should use execute_javascript as escape hatch instead.
      log.warn(
        { visionCallsUsed: this.visionCallsUsed, visionBudget: this.visionBudget },
        'Vision budget exhausted — skipping vision strategy (use execute_javascript instead)',
      );
    } else {
      const start = Date.now();
      strategiesAttempted.push('vision');
      this.visionCallsUsed++;
      const result = await groundViaVision(decision, page, this.visionProvider);
      strategyTimings['vision'] = Date.now() - start;

      if (result.element) {
        log.warn(
          { confidence: result.confidence, visionCallsUsed: this.visionCallsUsed, visionBudget: this.visionBudget },
          'Grounded via vision fallback — coordinate-based',
        );
        return {
          success: true,
          element: result.element,
          strategiesAttempted,
          strategyTimings,
        };
      }
    }

    // All strategies exhausted
    log.error(
      { decision: decision.targetDescription ?? decision.targetElementId },
      'All grounding strategies failed',
    );

    const visionNote = this.visionCallsUsed >= this.visionBudget
      ? ' Vision budget exhausted — use execute_javascript to interact directly.'
      : '';

    return {
      success: false,
      failureReason: `All grounding strategies failed for: ${decision.targetDescription ?? decision.targetElementId ?? 'unknown element'}.${visionNote}`,
      strategiesAttempted,
      strategyTimings,
    };
  }
}
