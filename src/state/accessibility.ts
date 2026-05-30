import type { Page } from 'playwright';
import {
  normalizeA11yTree,
  flattenInteractive,
  hashTree,
  type RawA11yNode,
} from './normalizer.js';
import type { AccessibilityNode, ClickableElement } from './types.js';
import { createLogger } from '../runtime/logger.js';

const log = createLogger('state:a11y');

// ─── A11y capturer ────────────────────────────────────────────────────────────

export interface A11yCaptureResult {
  tree: AccessibilityNode;
  clickableElements: ClickableElement[];
  treeHash: string;
}

/**
 * Capture and normalize the accessibility tree from the current page.
 *
 * Uses page.evaluate() to call the Chromium AX (accessibility) APIs directly,
 * since page.accessibility was deprecated in Playwright 1.45+.
 * Falls back to a minimal synthetic tree if the CDP snapshot fails.
 */
export async function captureAccessibilityTree(page: Page): Promise<A11yCaptureResult> {
  let raw: RawA11yNode | null = null;

  // Use CDP Accessibility.getFullAXTree via a CDPSession for best results
  try {
    const client = await page.context().newCDPSession(page);
    const result = await client.send('Accessibility.getFullAXTree') as {
      nodes: Array<{
        nodeId: string;
        role?: { value: string };
        name?: { value: string };
        description?: { value: string };
        value?: { value: string };
        parentId?: string;
        childIds?: string[];
        properties?: Array<{ name: string; value: { value: unknown } }>;
      }>;
    };
    await client.detach().catch(() => {});

    raw = buildTreeFromCDP(result.nodes);
  } catch (err) {
    log.debug({ err }, 'CDP AX tree failed, falling back to DOM evaluation');
  }

  // Fallback: lightweight DOM-based snapshot
  if (!raw) {
    try {
      raw = await page.evaluate((): RawA11yNode => {
        function nodeToRaw(el: Element, depth = 0): RawA11yNode {
          if (depth > 10) return { role: 'unknown' };
          const role = el.getAttribute('role') ?? el.tagName.toLowerCase();
          const name =
            el.getAttribute('aria-label') ??
            el.getAttribute('aria-labelledby') ??
            (el as HTMLElement).innerText?.slice(0, 100) ??
            '';
          const children: RawA11yNode[] = [];

          for (let i = 0; i < el.children.length; i++) {
            const child = el.children[i];
            if (child) children.push(nodeToRaw(child as Element, depth + 1));
          }

          return {
            role,
            name,
            disabled: (el as HTMLInputElement).disabled,
            checked: (el as HTMLInputElement).checked,
            value: (el as HTMLInputElement).value,
            children,
          };
        }
        return nodeToRaw(document.body);
      });
    } catch (err) {
      log.warn({ err }, 'DOM evaluation for a11y also failed');
    }
  }

  if (!raw) {
    const emptyTree: AccessibilityNode = {
      nodeId: 'root',
      role: 'document',
      name: '',
      isInteractive: false,
      isVisible: true,
      isDisabled: false,
      children: [],
      attributes: {},
    };
    return { tree: emptyTree, clickableElements: [], treeHash: hashTree(emptyTree) };
  }

  const tree = normalizeA11yTree(raw);
  if (!tree) {
    const emptyTree: AccessibilityNode = {
      nodeId: 'root',
      role: 'document',
      name: '',
      isInteractive: false,
      isVisible: true,
      isDisabled: false,
      children: [],
      attributes: {},
    };
    return { tree: emptyTree, clickableElements: [], treeHash: hashTree(emptyTree) };
  }

  const interactiveNodes = flattenInteractive(tree);
  const clickableElements: ClickableElement[] = interactiveNodes.map((node) => ({
    nodeId: node.nodeId,
    refId: '', // assigned in StateCapturer.capture() after this returns
    role: node.role,
    name: node.name,
    value: node.value,
    bounds: node.bounds,
    isVisible: node.isVisible,
    isDisabled: node.isDisabled,
    isChecked: node.isChecked,
  }));

  const treeHash = hashTree(tree);

  log.debug(
    { interactiveCount: clickableElements.length, treeHash: treeHash.slice(0, 8) },
    'A11y tree captured',
  );

  return { tree, clickableElements, treeHash };
}

// ─── Build tree from CDP AX nodes ─────────────────────────────────────────────

function buildTreeFromCDP(
  nodes: Array<{
    nodeId: string;
    role?: { value: string };
    name?: { value: string };
    description?: { value: string };
    value?: { value: string };
    parentId?: string;
    childIds?: string[];
    properties?: Array<{ name: string; value: { value: unknown } }>;
  }>,
): RawA11yNode {
  const nodeMap = new Map(nodes.map((n) => [n.nodeId, n]));

  function buildNode(nodeId: string, depth = 0): RawA11yNode {
    if (depth > 15) return { role: 'unknown' };
    const node = nodeMap.get(nodeId);
    if (!node) return { role: 'unknown' };

    const props: Record<string, unknown> = {};
    for (const p of node.properties ?? []) {
      props[p.name] = p.value.value;
    }

    const children: RawA11yNode[] = [];
    for (const childId of node.childIds ?? []) {
      children.push(buildNode(childId, depth + 1));
    }

    return {
      role: node.role?.value ?? 'unknown',
      name: node.name?.value ?? '',
      description: node.description?.value,
      value: node.value?.value,
      disabled: props['disabled'] === true,
      checked: props['checked'] === true || props['checked'] === 'true',
      expanded: props['expanded'] === true || props['expanded'] === 'true',
      children,
    };
  }

  // Find root node (no parentId, or parentId not in map)
  const root = nodes.find((n) => !n.parentId || !nodeMap.has(n.parentId));
  if (!root) return { role: 'document', children: [] };

  return buildNode(root.nodeId);
}
