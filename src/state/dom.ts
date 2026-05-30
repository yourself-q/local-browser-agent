import { createHash } from 'node:crypto';
import type { Page } from 'playwright';
import { createLogger } from '../runtime/logger.js';

const log = createLogger('state:dom');

// ─── DOM snapshot ─────────────────────────────────────────────────────────────

export interface DOMSnapshot {
  /** SHA1 of document.documentElement.outerHTML */
  hash: string;
  /** Lightweight element index: selector → text for grounding fallback */
  elementIndex: ElementIndexEntry[];
}

export interface ElementIndexEntry {
  selector: string;
  tagName: string;
  text: string;
  href?: string;
  type?: string;
  placeholder?: string;
  ariaLabel?: string;
  ariaRole?: string;
  id?: string;
  className?: string;
}

/**
 * Browser-side code passed as a string to page.evaluate().
 *
 * WHY STRING: tsx/esbuild transforms every named function/const inside
 * page.evaluate(() => { ... }) by injecting __name() helper calls.
 * __name is defined in the Node.js bundle but NOT in the browser context,
 * so the evaluate throws ReferenceError. Passing raw JS as a string bypasses
 * esbuild transformation entirely — the browser receives the code as-is.
 */
const DOM_SNAPSHOT_SCRIPT = /* js */ `
(function() {
  var TAGS = ['button','a','input','select','textarea','label'];
  var results = [];

  for (var t = 0; t < TAGS.length; t++) {
    var els = Array.prototype.slice.call(document.querySelectorAll(TAGS[t]));
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el.offsetParent && el.tagName.toLowerCase() !== 'body') continue;

      // Build stable selector
      var selector = '';
      if (el.id) {
        selector = '#' + el.id;
      } else {
        var al = el.getAttribute('aria-label');
        if (al) {
          selector = el.tagName.toLowerCase() + '[aria-label="' + al.replace(/"/g, '\\\\"') + '"]';
        } else {
          var parts = [];
          var cur = el;
          var depth = 0;
          while (cur && cur !== document.body && depth < 4) {
            var part = cur.tagName.toLowerCase();
            if (cur.id) { parts.unshift('#' + cur.id); break; }
            var sibs = cur.parentElement
              ? Array.prototype.filter.call(cur.parentElement.children, function(s) { return s.tagName === cur.tagName; })
              : [];
            if (sibs.length > 1) part += ':nth-of-type(' + (Array.prototype.indexOf.call(sibs, cur) + 1) + ')';
            parts.unshift(part);
            cur = cur.parentElement;
            depth++;
          }
          selector = parts.join(' > ');
        }
      }

      var entry = {
        selector: selector,
        tagName: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().slice(0, 120),
        ariaLabel: el.getAttribute('aria-label') || undefined,
        ariaRole: el.getAttribute('role') || undefined,
        id: el.id || undefined,
        className: el.className || undefined,
      };

      if (el.tagName === 'A') entry.href = el.href;
      if (el.tagName === 'INPUT') {
        entry.type = el.type;
        entry.placeholder = el.placeholder || undefined;
      }

      results.push(entry);
    }
  }
  return results;
})()
`;

/**
 * Capture a lightweight DOM snapshot for:
 * 1. Change detection (via hash)
 * 2. Grounding fallback (element index for CSS selector resolution)
 */
export async function captureDOMSnapshot(page: Page): Promise<DOMSnapshot> {
  const [htmlRaw, elementIndex] = await Promise.all([
    page.evaluate(() => document.documentElement.outerHTML.replace(/\s+/g, ' ').trim()),
    page.evaluate(DOM_SNAPSHOT_SCRIPT) as Promise<ElementIndexEntry[]>,
  ]);

  const hash = createHash('sha1').update(htmlRaw).digest('hex');

  log.debug({ hash: hash.slice(0, 8), elementCount: elementIndex.length }, 'DOM snapshot captured');

  return { hash, elementIndex };
}

// ─── Re-export type for grounding ─────────────────────────────────────────────

export type { ElementIndexEntry as DOMElementEntry };
