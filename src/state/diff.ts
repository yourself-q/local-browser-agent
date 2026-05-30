import type { BrowserState, StateDelta, AccessibilityNode, ModalAppearance } from './types.js';

// ─── State differ ─────────────────────────────────────────────────────────────

/**
 * Compute a structured delta between two BrowserState snapshots.
 * This delta is exposed to the planner and recovery system so they can
 * reason about _what actually changed_ rather than just checking success.
 */
export function diffStates(prev: BrowserState, curr: BrowserState): StateDelta {
  const urlChanged = prev.url !== curr.url;
  const treeChanged = prev.treeHash !== curr.treeHash;
  const domChanged = prev.domHash !== curr.domHash;
  const focusChanged = prev.focusedNodeId !== curr.focusedNodeId;

  const prevNodeIds = collectNodeIds(prev.accessibilityTree);
  const currNodeIds = collectNodeIds(curr.accessibilityTree);

  const removedIds = [...prevNodeIds].filter((id) => !currNodeIds.has(id));
  const addedIds = [...currNodeIds].filter((id) => !prevNodeIds.has(id));

  const nodesAdded = addedIds
    .map((id) => findNodeById(curr.accessibilityTree, id))
    .filter((n): n is AccessibilityNode => n !== null);

  const modals = detectModalChanges(
    prev.accessibilityTree,
    curr.accessibilityTree,
  );

  const tabsChanged =
    prev.tabs.length !== curr.tabs.length ||
    prev.tabs.some((t, i) => t.url !== curr.tabs[i]?.url || t.isActive !== curr.tabs[i]?.isActive);

  const anythingChanged =
    urlChanged || treeChanged || domChanged || focusChanged || tabsChanged;

  return {
    fromStep: prev.stepIndex,
    toStep: curr.stepIndex,
    urlChanged,
    previousUrl: urlChanged ? prev.url : undefined,
    currentUrl: urlChanged ? curr.url : undefined,
    treeChanged,
    domChanged,
    focusChanged,
    previousFocusedNodeId: focusChanged ? prev.focusedNodeId : undefined,
    currentFocusedNodeId: focusChanged ? curr.focusedNodeId : undefined,
    nodesAdded,
    nodesRemoved: removedIds,
    tabsChanged,
    modals,
    anythingChanged,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function collectNodeIds(node: AccessibilityNode, ids = new Set<string>()): Set<string> {
  ids.add(node.nodeId);
  for (const child of node.children) collectNodeIds(child, ids);
  return ids;
}

function findNodeById(node: AccessibilityNode, nodeId: string): AccessibilityNode | null {
  if (node.nodeId === nodeId) return node;
  for (const child of node.children) {
    const found = findNodeById(child, nodeId);
    if (found) return found;
  }
  return null;
}

const MODAL_ROLES = new Set(['dialog', 'alertdialog', 'alert']);

function detectModalChanges(
  prev: AccessibilityNode,
  curr: AccessibilityNode,
): ModalAppearance[] {
  const prevModals = collectByRoles(prev, MODAL_ROLES);
  const currModals = collectByRoles(curr, MODAL_ROLES);

  const prevIds = new Map(prevModals.map((n) => [n.nodeId, n]));
  const currIds = new Map(currModals.map((n) => [n.nodeId, n]));

  const changes: ModalAppearance[] = [];

  for (const [id, node] of currIds) {
    if (!prevIds.has(id)) {
      changes.push({ type: 'appeared', nodeId: id, role: node.role, name: node.name });
    }
  }

  for (const [id] of prevIds) {
    if (!currIds.has(id)) {
      changes.push({ type: 'disappeared', nodeId: id });
    }
  }

  return changes;
}

function collectByRoles(
  node: AccessibilityNode,
  roles: Set<string>,
  result: AccessibilityNode[] = [],
): AccessibilityNode[] {
  if (roles.has(node.role)) result.push(node);
  for (const child of node.children) collectByRoles(child, roles, result);
  return result;
}
