import { createHash } from 'node:crypto';
import {
  computeSemanticFingerprint,
  computeAncestorPathId,
  normalizeName,
  isLandmark,
} from './fingerprint.js';
import type { AccessibilityNode } from './types.js';

// ─── ARIA interactive roles ───────────────────────────────────────────────────

const INTERACTIVE_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'gridcell',  // interactive grid cell (spreadsheet-like), distinct from static 'cell'
  'link',
  'listbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'scrollbar',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox',
  'treeitem',
  // NOTE: 'cell', 'columnheader', 'rowheader' intentionally excluded —
  // these are structural table roles, not interactive. Including them causes
  // static table cells (e.g. HN story rows) to flood the clickable element list.
]);

// Noise roles — presentational with no semantic value for grounding
const NOISE_ROLES = new Set([
  'none',
  'presentation',
  'generic',
  'group',
]);

// ─── Role normalization map ───────────────────────────────────────────────────

const ROLE_MAP: Record<string, string> = {
  'text input': 'textbox',
  'password input': 'textbox',
  'search field': 'searchbox',
  'combo box': 'combobox',
  'list box': 'listbox',
  'check box': 'checkbox',
  'radio button': 'radio',
  'push button': 'button',
  'toggle button': 'button',
  'pop up button': 'combobox',
  hyperlink: 'link',
  image: 'img',
};

function normalizeRole(rawRole: string): string {
  return ROLE_MAP[rawRole.toLowerCase()] ?? rawRole.toLowerCase();
}

// ─── Raw a11y node (Playwright/CDP snapshot format) ───────────────────────────

export interface RawA11yNode {
  role?: string;
  name?: string;
  description?: string;
  value?: string;
  checked?: boolean;
  pressed?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  focused?: boolean;
  multiselectable?: boolean;
  haspopup?: boolean | string;
  level?: number;
  children?: RawA11yNode[];
}

// ─── Context passed down during normalization ─────────────────────────────────

interface NormContext {
  nearestLandmark: string;
  /** count of already-processed siblings by role within the nearest landmark */
  siblingCountByRole: Map<string, number>;
}

// ─── Normalizer ───────────────────────────────────────────────────────────────

export function normalizeA11yTree(
  raw: RawA11yNode,
  ancestorPath = '',
  depth = 0,
  ctx?: NormContext,
): AccessibilityNode | null {
  const rawRole = raw.role ?? 'unknown';
  const role = normalizeRole(rawRole);
  const name = normalizeName(raw.name ?? '');

  // Drop decorative images
  if (role === 'img' && !name) return null;

  // Drop pure noise nodes with no name and no children
  if (NOISE_ROLES.has(role) && !name && (!raw.children || raw.children.length === 0)) {
    return null;
  }

  // Build landmark-relative context
  const currentLandmark = isLandmark(role) ? role : (ctx?.nearestLandmark ?? 'document');
  const siblingCounts = isLandmark(role)
    ? new Map<string, number>() // new landmark resets sibling counts
    : (ctx?.siblingCountByRole ?? new Map<string, number>());

  const siblingCount = siblingCounts.get(role) ?? 0;
  siblingCounts.set(role, siblingCount + 1);

  // Compute stable semantic fingerprint
  const fingerprint = computeSemanticFingerprint(role, name, currentLandmark, siblingCount);

  // Also compute the legacy path-based ID as a debug reference
  const path = ancestorPath ? `${ancestorPath}/${role}:${name}` : `${role}:${name}`;
  const legacyId = computeAncestorPathId(role, name, path);

  // Build child context — each landmark level gets fresh sibling tracking
  const childCtx: NormContext = {
    nearestLandmark: currentLandmark,
    siblingCountByRole: isLandmark(role)
      ? new Map<string, number>()
      : new Map(siblingCounts), // pass current counts to children at same level
  };

  const children: AccessibilityNode[] = [];
  // Reset per-child sibling tracking at each node level
  const childSiblingCounts = new Map<string, number>();

  for (const child of raw.children ?? []) {
    const childCtxAtLevel: NormContext = {
      nearestLandmark: currentLandmark,
      siblingCountByRole: childSiblingCounts,
    };
    const childNode = normalizeA11yTree(child, path, depth + 1, childCtxAtLevel);
    if (childNode !== null) {
      children.push(childNode);
    }
  }

  const isInteractive = INTERACTIVE_ROLES.has(role);
  const isDisabled = raw.disabled === true;
  const isVisible = !isDisabled;

  return {
    nodeId: fingerprint.hash,
    role,
    name,
    description: raw.description,
    value: raw.value,
    isInteractive,
    isVisible,
    isDisabled,
    isExpanded: raw.expanded,
    isChecked: raw.checked,
    bounds: undefined,
    children,
    attributes: {
      ...buildAttributes(raw),
      'data-fingerprint-debug': fingerprint.debug,
      'data-legacy-id': legacyId,
    },
  };
}

/** Flatten tree to get all interactive non-disabled visible nodes */
export function flattenInteractive(node: AccessibilityNode): AccessibilityNode[] {
  const results: AccessibilityNode[] = [];
  if (node.isInteractive && node.isVisible && !node.isDisabled) {
    results.push(node);
  }
  for (const child of node.children) {
    results.push(...flattenInteractive(child));
  }
  return results;
}

// ─── Hash utilities ───────────────────────────────────────────────────────────

/** Legacy path-based nodeId — kept for backward compatibility and fallback */
export function computeNodeId(role: string, name: string, path: string): string {
  return computeAncestorPathId(role, name, path);
}

/** Hash the tree for change detection (excludes bounds, changes with content) */
export function hashTree(node: AccessibilityNode): string {
  const repr = JSON.stringify(node, (key, value) => {
    if (key === 'bounds') return undefined;
    if (key === 'data-fingerprint-debug') return undefined;
    if (key === 'data-legacy-id') return undefined;
    return value as unknown;
  });
  return createHash('sha1').update(repr).digest('hex');
}

// ─── Attributes builder ───────────────────────────────────────────────────────

function buildAttributes(raw: RawA11yNode): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (raw.checked !== undefined) attrs['aria-checked'] = String(raw.checked);
  if (raw.pressed !== undefined) attrs['aria-pressed'] = String(raw.pressed);
  if (raw.expanded !== undefined) attrs['aria-expanded'] = String(raw.expanded);
  if (raw.disabled !== undefined) attrs['aria-disabled'] = String(raw.disabled);
  if (raw.level !== undefined) attrs['aria-level'] = String(raw.level);
  if (raw.multiselectable) attrs['aria-multiselectable'] = 'true';
  if (raw.haspopup) attrs['aria-haspopup'] = String(raw.haspopup);
  return attrs;
}
