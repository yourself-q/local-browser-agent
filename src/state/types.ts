// ─── Geometric primitives ────────────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─── Accessibility tree ───────────────────────────────────────────────────────

/** Normalized accessibility node with a stable, deterministic ID. */
export interface AccessibilityNode {
  /** sha1(role:name:ancestorPath) — stable across re-renders when structure is unchanged */
  nodeId: string;
  /** ARIA 1.2 role (normalized, noise roles stripped) */
  role: string;
  /** Accessible name */
  name: string;
  description?: string;
  /** Current value (for inputs, selects, etc.) */
  value?: string;
  /** True when role is in the ARIA interactive roles list */
  isInteractive: boolean;
  isVisible: boolean;
  isDisabled: boolean;
  isExpanded?: boolean;
  isChecked?: boolean;
  /** Viewport-relative bounding box — undefined if off-screen or not computable */
  bounds?: Rect;
  children: AccessibilityNode[];
  /** Aria attributes and data-* attributes preserved for grounding */
  attributes: Record<string, string>;
}

// ─── Clickable elements (flattened, for LLM prompt injection) ─────────────────

export interface SelectOption {
  value: string;
  text: string;
  selected: boolean;
}

export interface ClickableElement {
  nodeId: string;
  /** Step-local display ID assigned fresh each step — do NOT persist across steps. */
  refId: string;
  role: string;
  name: string;
  value?: string;
  bounds?: Rect;
  isVisible: boolean;
  isDisabled: boolean;
  /** True when a radio/checkbox is currently checked, or an option is selected */
  isChecked?: boolean;
  /** For <select> elements: all available options */
  options?: SelectOption[];
}

// ─── Tab info ─────────────────────────────────────────────────────────────────

export interface TabInfo {
  /** Playwright Page index in context */
  index: number;
  url: string;
  title: string;
  isActive: boolean;
}

// ─── Browser state ────────────────────────────────────────────────────────────

export interface BrowserState {
  sessionId: string;
  stepIndex: number;
  timestamp: number;
  url: string;
  title: string;
  tabs: TabInfo[];
  accessibilityTree: AccessibilityNode;
  clickableElements: ClickableElement[];
  /** Viewport height in CSS pixels at capture time */
  viewportHeight: number;
  /** SHA1 of serialized a11y tree — used for change detection */
  treeHash: string;
  /** SHA1 of page outerHTML — used for DOM mutation detection */
  domHash: string;
  /** Current focused element's nodeId, if any */
  focusedNodeId?: string;
  /** Base64-encoded PNG, populated only when screenshot is requested */
  screenshot?: string;
}

// ─── State diff / delta ───────────────────────────────────────────────────────

export type ModalAppearance =
  | { type: 'appeared'; nodeId: string; role: string; name: string }
  | { type: 'disappeared'; nodeId: string };

export interface StateDelta {
  /** Previous step index */
  fromStep: number;
  /** Current step index */
  toStep: number;
  /** URL changed */
  urlChanged: boolean;
  previousUrl?: string;
  currentUrl?: string;
  /** Accessibility tree structurally changed */
  treeChanged: boolean;
  /** DOM content changed (even if a11y tree didn't) */
  domChanged: boolean;
  /** Focused element changed */
  focusChanged: boolean;
  previousFocusedNodeId?: string;
  currentFocusedNodeId?: string;
  /** Nodes added to the tree */
  nodesAdded: AccessibilityNode[];
  /** Node IDs removed from the tree */
  nodesRemoved: string[];
  /** Tabs opened or closed */
  tabsChanged: boolean;
  /** Modal dialogs that appeared or disappeared */
  modals: ModalAppearance[];
  /** Summary signal for verification */
  anythingChanged: boolean;
}
