import type { Page } from 'playwright';
import levenshtein from 'fast-levenshtein';
import type { AccessibilityNode, BrowserState } from '../../state/types.js';
import { flattenInteractive } from '../../state/normalizer.js';
import type { ActionDecision } from '../../llm/types.js';
import type { GroundedElement } from '../types.js';
import { createLogger } from '../../runtime/logger.js';

const log = createLogger('grounding:a11y');

// ─── A11y grounding strategy ──────────────────────────────────────────────────

export interface A11yGroundingResult {
  element?: GroundedElement;
  confidence: number;
  reason?: string;
}

/**
 * Primary grounding strategy.
 *
 * Grounding order:
 * 1. Exact match by nodeId (LLM returned a valid nodeId from the state)
 * 2. Fuzzy match by role + name (normalized Levenshtein)
 * 3. Any match by text content alone (last a11y resort)
 */
export async function groundViaA11y(
  decision: ActionDecision,
  state: BrowserState,
  page: Page,
): Promise<A11yGroundingResult> {
  // Strip accidental brackets the LLM sometimes adds: "[ref_3]" → "ref_3"
  const rawId = String(decision.targetElementId ?? '').trim();
  const targetElementId = rawId.replace(/^\[/, '').replace(/\]$/, '');
  const targetDescription = String(decision.targetDescription ?? '');

  // 1. data-agent-ref CSS selector (primary — always unambiguous)
  //    DOM injection writes data-agent-ref="ref_N" to the exact element.
  //    CSS attribute selector finds it directly — no role+name text search,
  //    no "first match" ambiguity. Mirrors WeakRef lookup in reference impl.
  if (targetElementId.startsWith('ref_')) {
    const cssSelector = `[data-agent-ref="${targetElementId}"]`;

    // Try main frame first
    const mainLocator = page.locator(cssSelector);
    const mainCount = await mainLocator.count().catch(() => 0);
    if (mainCount > 0) {
      const target = mainCount > 1 ? mainLocator.first() : mainLocator;
      const isVisible = await target.isVisible().catch(() => false);
      const isEnabled = await target.isEnabled().catch(() => false);
      const boundingBox = await target.boundingBox().catch(() => null);
      log.debug({ refId: targetElementId, strategy: 'data-agent-ref:main' }, 'Grounded via data-agent-ref');
      return {
        element: {
          nodeId: targetElementId,
          locator: target,
          bounds: boundingBox ?? { x: 0, y: 0, width: 0, height: 0 },
          strategy: 'a11y',
          confidence: 1.0,
          isVisible,
          isClickable: isVisible && isEnabled,
        },
        confidence: 1.0,
      };
    }

    // Try sub-frames (for iframe-hosted content)
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
        const fl = frame.locator(cssSelector);
        const fc = await fl.count().catch(() => 0);
        if (fc > 0) {
          const target = fc > 1 ? fl.first() : fl;
          const isVisible = await target.isVisible().catch(() => false);
          const isEnabled = await target.isEnabled().catch(() => false);
          const boundingBox = await target.boundingBox().catch(() => null);
          log.debug({ refId: targetElementId, frameUrl: frame.url(), strategy: 'data-agent-ref:frame' }, 'Grounded via data-agent-ref in sub-frame');
          return {
            element: {
              nodeId: targetElementId,
              locator: target,
              bounds: boundingBox ?? { x: 0, y: 0, width: 0, height: 0 },
              strategy: 'a11y',
              confidence: 1.0,
              isVisible,
              isClickable: isVisible && isEnabled,
            },
            confidence: 1.0,
          };
        }
      } catch { /* detached frame */ }
    }

    log.debug({ refId: targetElementId }, 'data-agent-ref not found in DOM — falling through to fuzzy match');
  }

  // 2. Exact nodeId match (legacy / fallback for hash-style IDs)
  if (targetElementId) {
    const node = findByNodeId(state.accessibilityTree, targetElementId);
    if (node) {
      log.debug({ nodeId: targetElementId }, 'Exact nodeId match');
      return resolveNode(node, page, 1.0);
    }
    log.debug({ nodeId: targetElementId }, 'NodeId not found in current tree');
  }

  // 2. Fuzzy match by description
  if (targetDescription) {
    const interactiveNodes = flattenInteractiveFromTree(state.accessibilityTree);
    const match = fuzzyMatch(targetDescription, interactiveNodes);
    if (match) {
      log.debug({ nodeId: match.node.nodeId, score: match.score }, 'Fuzzy match');
      return resolveNode(match.node, page, match.score);
    }
  }

  return { confidence: 0, reason: 'No a11y match found' };
}

// ─── Helper wrappers ──────────────────────────────────────────────────────────

function flattenInteractiveFromTree(tree: AccessibilityNode): AccessibilityNode[] {
  return flattenInteractive(tree);
}

// ─── Node resolution ──────────────────────────────────────────────────────────

async function resolveNode(
  node: AccessibilityNode,
  page: Page,
  confidence: number,
): Promise<A11yGroundingResult> {
  // Build a Playwright locator from the node's accessible properties
  const locator = await buildLocator(node, page);

  try {
    const count = await locator.count();
    if (count === 0) {
      log.debug({ nodeId: node.nodeId }, 'Locator matched no elements');
      return { confidence: 0, reason: 'Locator matched no elements in DOM' };
    }

    const target = count > 1 ? locator.first() : locator;

    const isVisible = await target.isVisible().catch(() => false);
    const isEnabled = await target.isEnabled().catch(() => false);

    const boundingBox = await target.boundingBox().catch(() => null);

    const grounded: GroundedElement = {
      nodeId: node.nodeId,
      locator: target,
      bounds: boundingBox ?? { x: 0, y: 0, width: 0, height: 0 },
      strategy: 'a11y',
      confidence,
      isVisible,
      isClickable: isVisible && isEnabled,
    };

    return { element: grounded, confidence };
  } catch (err) {
    log.debug({ err, nodeId: node.nodeId }, 'Locator resolution error');
    return { confidence: 0, reason: String(err) };
  }
}

// ─── Locator builder ──────────────────────────────────────────────────────────

/**
 * Build a Playwright Locator for the given a11y node.
 *
 * page.getByRole() only searches the MAIN frame. For iframe-hosted elements
 * (common on LMS / quiz pages) we must fall through to each sub-frame.
 *
 * Reference: open-claude-in-chrome runs content scripts in all_frames:true
 * so the element WeakRef map is per-frame. We replicate that by iterating
 * page.frames() when the main frame returns 0 matches.
 */
async function buildLocator(node: AccessibilityNode, page: Page) {
  const role = node.role as Parameters<Page['getByRole']>[0];

  if (node.name) {
    // 1. Try main frame first (fast path)
    const main = page.getByRole(role, { name: node.name, exact: false });
    if ((await main.count().catch(() => 0)) > 0) return main;

    // 2. Iterate sub-frames (handles iframe-hosted content)
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
        const fl = frame.getByRole(role, { name: node.name, exact: false });
        if ((await fl.count().catch(() => 0)) > 0) {
          log.debug({ frameUrl: frame.url(), role, name: node.name }, 'Found element in sub-frame');
          return fl;
        }
      } catch {
        // frame might be detached — skip
      }
    }

    // 3. Give main-frame locator back anyway (DOM fallback will take over if count=0)
    return main;
  }

  // No name — role only (last resort, often matches many elements)
  return page.getByRole(role);
}

// ─── Fuzzy matching ───────────────────────────────────────────────────────────

interface FuzzyMatch {
  node: AccessibilityNode;
  score: number; // 0.0–1.0, higher = better
}

function fuzzyMatch(description: string, nodes: AccessibilityNode[]): FuzzyMatch | null {
  // eslint-disable-next-line no-shadow
  const query = description.toLowerCase().trim();
  let best: FuzzyMatch | null = null;

  for (const node of nodes) {
    if (node.isDisabled) continue;

    const name = node.name.toLowerCase().trim();
    const value = (node.value ?? '').toLowerCase().trim();
    const combined = [name, value, node.role].join(' ');

    // Exact substring match → high confidence
    if (name.includes(query) || query.includes(name)) {
      const score = Math.min(name.length, query.length) / Math.max(name.length, query.length);
      if (!best || score > best.score) {
        best = { node, score: 0.7 + score * 0.3 };
      }
      continue;
    }

    // Levenshtein distance
    const distance = levenshtein.get(query, name);
    const maxLen = Math.max(query.length, name.length);
    const similarity = maxLen === 0 ? 1 : 1 - distance / maxLen;

    if (similarity > 0.6 && (!best || similarity > best.score)) {
      best = { node, score: similarity };
    }

    // Try combined field
    if (combined.includes(query)) {
      const score = 0.55;
      if (!best || score > best.score) {
        best = { node, score };
      }
    }
  }

  // Only return if confidence is meaningful
  return best && best.score >= 0.5 ? best : null;
}

// ─── Tree lookup ──────────────────────────────────────────────────────────────

function findByNodeId(node: AccessibilityNode, nodeId: string): AccessibilityNode | null {
  if (node.nodeId === nodeId) return node;
  for (const child of node.children) {
    const found = findByNodeId(child, nodeId);
    if (found) return found;
  }
  return null;
}
