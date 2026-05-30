import { createHash } from 'node:crypto';

// ─── Stable semantic fingerprint ──────────────────────────────────────────────

/**
 * Compute a nodeId that is stable across React re-renders and hydration.
 *
 * Problem with ancestorPath:
 *   React adds/removes wrapper divs during hydration, causing ancestorPath to
 *   shift even though the element is semantically the same.
 *
 * Solution:
 *   Anchor the identity to the nearest ARIA landmark ancestor + position
 *   among siblings of the same role within that landmark.
 *   This is stable across typical re-render cycles.
 *
 * Fingerprint = sha1(role + normalizedName + landmark + siblingIndex)
 */
export interface SemanticFingerprint {
  role: string;
  name: string;
  /** Nearest landmark ancestor role (main, nav, header, aside, dialog, ...) */
  landmark: string;
  /** Zero-based index among same-role siblings within the landmark */
  siblingIndex: number;
  /** Full fingerprint hash (16 hex chars) */
  hash: string;
  /** Human-readable debug label */
  debug: string;
}

const LANDMARK_ROLES = new Set([
  'main',
  'navigation',
  'banner',
  'contentinfo',
  'complementary',
  'search',
  'form',
  'dialog',
  'alertdialog',
  'region',
  'article',
  'aside',
  'header',
  'footer',
  // HTML elements that become landmarks
  'document',
  'application',
]);

/**
 * Build a stable semantic fingerprint for a node.
 * Used as the primary nodeId in the normalized tree.
 *
 * @param role - ARIA role
 * @param name - Accessible name (normalized: trimmed, whitespace-collapsed)
 * @param nearestLandmark - Role of the nearest landmark ancestor
 * @param siblingIndex - Position among same-role siblings in landmark
 */
export function computeSemanticFingerprint(
  role: string,
  name: string,
  nearestLandmark: string,
  siblingIndex: number,
): SemanticFingerprint {
  const normalizedName = name.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);
  const key = `${role}|${normalizedName}|${nearestLandmark}|${siblingIndex}`;
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 16);

  return {
    role,
    name: normalizedName,
    landmark: nearestLandmark,
    siblingIndex,
    hash,
    debug: `${role}:${normalizedName}@${nearestLandmark}[${siblingIndex}]`,
  };
}

export function isLandmark(role: string): boolean {
  return LANDMARK_ROLES.has(role);
}

// ─── Legacy ancestor-path based ID (fallback) ─────────────────────────────────

/**
 * Original ancestor-path based nodeId.
 * Less stable under React re-renders, but useful as a fallback when
 * semantic fingerprinting cannot be applied (e.g., very flat trees).
 */
export function computeAncestorPathId(role: string, name: string, path: string): string {
  return createHash('sha1').update(`${role}:${name}:${path}`).digest('hex').slice(0, 16);
}

// ─── Name normalization ────────────────────────────────────────────────────────

/**
 * Normalize an accessible name for stable fingerprinting.
 * Collapses whitespace, trims, lowercases, truncates to 80 chars.
 */
export function normalizeName(raw: string): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
}
