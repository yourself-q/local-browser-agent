import type { Page } from 'playwright';
import { captureAccessibilityTree } from './accessibility.js';
import type { AccessibilityNode } from './types.js';

// ─── Temporal stability analysis ──────────────────────────────────────────────

/**
 * Measure how stable the accessibility tree is over time.
 *
 * Captures the tree at t=0, t=delay1, t=delay2 and computes:
 * - nodeId overlap % (stability of identifiers)
 * - name stability (accessible names that change)
 * - role stability (roles that flip)
 * - churn rate (how many new nodes appear per capture)
 *
 * This is critical for:
 * - Detecting React hydration windows
 * - Detecting animated/transient DOM nodes
 * - Choosing appropriate capture timing
 * - Warning about skeleton/loading UIs
 */
export interface TemporalStabilityResult {
  /** 0.0–1.0, higher = more stable */
  overallStability: number;
  captures: CaptureSnapshot[];
  nodeIdOverlap12: number; // overlap between capture 1 and 2 (0.0–1.0)
  nodeIdOverlap23: number; // overlap between capture 2 and 3 (0.0–1.0)
  churningNodes: ChurningNode[];
  recommendation: string;
}

export interface CaptureSnapshot {
  delay: number;
  nodeCount: number;
  interactiveCount: number;
  treeHash: string;
  nodeIds: Set<string>;
}

export interface ChurningNode {
  nodeId: string;
  role: string;
  name: string;
  /** 'added' = appeared, 'removed' = disappeared */
  pattern: 'added' | 'removed' | 'toggling';
}

/**
 * Capture the a11y tree at 3 points in time and analyze stability.
 * Default delays: 0ms, 300ms, 800ms — covers React hydration and initial renders.
 */
export async function analyzeTemporalStability(
  page: Page,
  delays = [0, 300, 800],
): Promise<TemporalStabilityResult> {
  const captures: CaptureSnapshot[] = [];

  for (const delay of delays) {
    if (delay > 0) {
      await page.waitForTimeout(delay - (captures.length > 0 ? delays[captures.length - 1]! : 0));
    }
    const result = await captureAccessibilityTree(page);
    const allNodes = collectAllNodes(result.tree);

    captures.push({
      delay,
      nodeCount: allNodes.length,
      interactiveCount: result.clickableElements.length,
      treeHash: result.treeHash,
      nodeIds: new Set(allNodes.map((n) => n.nodeId)),
    });
  }

  const c1 = captures[0]!;
  const c2 = captures[1]!;
  const c3 = captures[2]!;

  const overlap12 = computeOverlap(c1.nodeIds, c2.nodeIds);
  const overlap23 = computeOverlap(c2.nodeIds, c3.nodeIds);
  const overallStability = (overlap12 + overlap23) / 2;

  // Identify churning nodes
  const churningNodes = findChurningNodes(c1.nodeIds, c2.nodeIds, c3.nodeIds);

  return {
    overallStability,
    captures,
    nodeIdOverlap12: overlap12,
    nodeIdOverlap23: overlap23,
    churningNodes,
    recommendation: buildRecommendation(overallStability, churningNodes.length),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function collectAllNodes(node: AccessibilityNode, result: AccessibilityNode[] = []): AccessibilityNode[] {
  result.push(node);
  for (const child of node.children) collectAllNodes(child, result);
  return result;
}

function computeOverlap(set1: Set<string>, set2: Set<string>): number {
  if (set1.size === 0 && set2.size === 0) return 1;
  if (set1.size === 0 || set2.size === 0) return 0;
  const intersection = [...set1].filter((id) => set2.has(id)).length;
  return intersection / Math.max(set1.size, set2.size);
}

function findChurningNodes(
  ids1: Set<string>,
  ids2: Set<string>,
  ids3: Set<string>,
): ChurningNode[] {
  const churning: ChurningNode[] = [];

  // Nodes present in c1 and c3 but missing from c2 (transient removal)
  for (const id of ids1) {
    if (!ids2.has(id) && ids3.has(id)) {
      churning.push({
        nodeId: id,
        role: 'unknown',
        name: id,
        pattern: 'toggling',
      });
    }
  }

  // Nodes absent in c1 but present in c2 and c3 (appears after render)
  for (const id of ids2) {
    if (!ids1.has(id) && ids3.has(id)) {
      churning.push({
        nodeId: id,
        role: 'unknown',
        name: id,
        pattern: 'added',
      });
    }
  }

  return churning.slice(0, 20); // cap at 20 for reporting
}

function buildRecommendation(stability: number, churningCount: number): string {
  if (stability >= 0.95) {
    return 'Page is very stable. Grounding should be reliable.';
  } else if (stability >= 0.80) {
    return `Page is mostly stable (${churningCount} churning nodes). Wait for network idle before capturing.`;
  } else if (stability >= 0.60) {
    return `Page is moderately dynamic (${churningCount} churning nodes). Use temporal retry — capture, wait 500ms, re-capture if hash changed.`;
  } else {
    return `Page is highly dynamic (stability=${(stability * 100).toFixed(0)}%). Consider waiting for DOM mutations to settle, or use a longer pre-capture delay.`;
  }
}
