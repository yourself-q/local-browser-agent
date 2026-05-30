import type { Page, Frame } from 'playwright';
import type { ClickableElement, SelectOption } from './types.js';
import { createLogger } from '../runtime/logger.js';

const log = createLogger('state:dom-inject');

// ─── DOM injection script (string form to avoid esbuild transformation) ────────
//
// Mirrors open-claude-in-chrome content.js:
//   - getRole()          → same TAG_TO_ROLE map + input type mapping
//   - getAccessibleName() → aria-label → aria-labelledby → placeholder → label[for] → textContent
//   - isInteractive()    → same set of tags + roles + tabIndex + onclick + contentEditable
//   - isVisible()        → offsetParent + getComputedStyle
//   - walk()             → recursive DOM walk including shadowRoot (reference impl does this too)
//
// Key difference from reference: instead of WeakRef (persistent), we write
// data-agent-ref attributes into the DOM so Playwright can find elements via
// CSS attribute selector `[data-agent-ref="ref_N"]` — always unambiguous.

const INJECT_SCRIPT = /* js */ `
(function(startRef) {
  var counter = startRef | 0;
  var results = [];

  // Clear stale refs from previous step
  var stale = document.querySelectorAll('[data-agent-ref]');
  for (var s = 0; s < stale.length; s++) stale[s].removeAttribute('data-agent-ref');

  // ── Role mapping (mirrors reference TAG_TO_ROLE) ──────────────────────────
  var TAG_TO_ROLE = {
    a: 'link', button: 'button', input: 'textbox', textarea: 'textbox',
    select: 'combobox', img: 'img',
    h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
    nav: 'navigation', main: 'main', header: 'banner', footer: 'contentinfo',
    aside: 'complementary', form: 'form', table: 'table', tr: 'row',
    th: 'columnheader', td: 'cell', ul: 'list', ol: 'list', li: 'listitem',
    dialog: 'dialog', details: 'group', summary: 'button',
    progress: 'progressbar', meter: 'meter', section: 'region', article: 'article',
  };

  function getRole(el) {
    var ar = el.getAttribute('role');
    if (ar) return ar;
    var tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      var t = (el.type || 'text').toLowerCase();
      var typeRoles = { checkbox: 'checkbox', radio: 'radio', range: 'slider',
                        button: 'button', submit: 'button', reset: 'button',
                        search: 'searchbox', number: 'spinbutton' };
      return typeRoles[t] || 'textbox';
    }
    return TAG_TO_ROLE[tag] || null;
  }

  // ── Accessible name (mirrors reference getAccessibleName) ─────────────────
  function getName(el) {
    var al = el.getAttribute('aria-label');
    if (al) return al.trim();
    var lb = el.getAttribute('aria-labelledby');
    if (lb) {
      var names = lb.split(/\\s+/).map(function(id) {
        var t = document.getElementById(id);
        return t ? t.textContent.trim() : '';
      }).filter(Boolean);
      if (names.length) return names.join(' ');
    }
    if (el.placeholder) return el.placeholder.trim();
    if (el.title) return el.title.trim();
    if (el.alt) return el.alt.trim();
    if (el.id) {
      try {
        var lf = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (lf) return lf.textContent.trim();
      } catch(e) {}
    }
    var cl = el.closest('label');
    if (cl) { var ct = cl.textContent.trim(); if (ct) return ct; }
    var tag2 = el.tagName.toLowerCase();
    if (['a','button','h1','h2','h3','h4','h5','h6','li','summary',
         'label','th','td','span'].indexOf(tag2) >= 0) {
      var tx = el.textContent ? el.textContent.trim() : '';
      if (tx && tx.length < 200) return tx;
    }
    // For <select>: try to extract question label from surrounding table cell or
    // preceding sibling text — common pattern on quiz/form pages.
    if (tag2 === 'select') {
      var td = el.closest('td, th');
      if (td) {
        var row = td.closest('tr');
        if (row) {
          var cells = row.querySelectorAll('td, th');
          if (cells.length > 1 && cells[0] !== td) {
            var ct2 = cells[0].textContent.trim();
            if (ct2 && ct2.length < 60) return ct2;
          }
        }
      }
      // Preceding sibling text node
      var prev = el.previousSibling;
      while (prev) {
        if (prev.nodeType === 3) { // TEXT_NODE
          var pt = prev.textContent.trim();
          if (pt && pt.length < 60) return pt;
        }
        prev = prev.previousSibling;
      }
    }
    return '';
  }

  // ── Visibility (mirrors reference isVisible) ──────────────────────────────
  function isVisible(el) {
    if (!el.offsetParent && el.tagName.toLowerCase() !== 'body' &&
        window.getComputedStyle(el).position !== 'fixed') return false;
    var st = window.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    return true;
  }

  // ── Interactivity (mirrors reference isInteractive) ───────────────────────
  function isInteractive(el) {
    var tag = el.tagName.toLowerCase();
    if (['a','button','input','textarea','select','summary','details'].indexOf(tag) >= 0) return true;
    var role = el.getAttribute('role');
    if (role && ['button','link','textbox','checkbox','radio','tab','menuitem',
                 'switch','combobox','slider','spinbutton','searchbox','option'].indexOf(role) >= 0) return true;
    if (el.tabIndex >= 0) return true;
    if (el.getAttribute('onclick')) return true;
    if (el.contentEditable === 'true') return true;
    return false;
  }

  // ── DOM walker (mirrors reference walk, including shadowRoot) ─────────────
  function walk(el, depth) {
    if (!el || el.nodeType !== 1) return;
    if (depth > 20) return;
    var tag = el.tagName.toLowerCase();
    if (['script','style','noscript','template'].indexOf(tag) >= 0) return;

    if (isInteractive(el) && isVisible(el)) {
      var refId = 'ref_' + (++counter);
      el.setAttribute('data-agent-ref', refId);

      var role = getRole(el) || tag;
      var name = getName(el).substring(0, 100);
      var val = (el.value !== undefined && el.value !== null) ? String(el.value).substring(0, 80) : '';
      var disabled = !!(el.disabled || el.getAttribute('aria-disabled') === 'true');
      var checked = !!(el.checked || el.getAttribute('aria-checked') === 'true');
      var rect = el.getBoundingClientRect();

      var entry = {
        refId: refId,
        role: role,
        name: name,
        value: val || undefined,
        isDisabled: disabled,
        isChecked: checked,
        bounds: { x: Math.round(rect.x), y: Math.round(rect.y),
                  width: Math.round(rect.width), height: Math.round(rect.height) }
      };

      // <select> options (reference shows these inline in a11y tree)
      if (tag === 'select' && el.options) {
        entry.options = Array.from(el.options).map(function(o) {
          return { value: o.value, text: o.textContent ? o.textContent.trim() : '', selected: o.selected };
        });
      }

      results.push(entry);
    }

    // Walk shadow DOM (mirrors reference shadowRoot handling)
    if (el.shadowRoot) {
      for (var sc = 0; sc < el.shadowRoot.children.length; sc++) {
        walk(el.shadowRoot.children[sc], depth + 1);
      }
    }

    for (var c = 0; c < el.children.length; c++) {
      walk(el.children[c], depth + 1);
    }
  }

  walk(document.body, 0);
  return { elements: results, nextCounter: counter, viewportHeight: window.innerHeight };
})
`;

// ─── Raw element shape returned by the script ──────────────────────────────────

interface RawElement {
  refId: string;
  role: string;
  name: string;
  value?: string;
  isDisabled: boolean;
  isChecked: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  options?: Array<{ value: string; text: string; selected: boolean }>;
}

interface ScriptResult {
  elements: RawElement[];
  nextCounter: number;
  viewportHeight: number;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Inject data-agent-ref attributes into every interactive element across all
 * frames and return the flattened ClickableElement list.
 *
 * Mirrors open-claude-in-chrome content.js: each element gets a unique ref that
 * can be resolved later via CSS selector [data-agent-ref="ref_N"].
 * Using a CSS selector is 100% unambiguous — no role+name text search needed.
 */
export interface InjectResult {
  elements: ClickableElement[];
  viewportHeight: number;
}

export async function injectAgentRefs(page: Page): Promise<InjectResult> {
  const all: ClickableElement[] = [];
  let counter = 0;
  let viewportHeight = page.viewportSize()?.height ?? 900;

  const frames: Frame[] = [page.mainFrame(), ...page.frames().filter((f) => f !== page.mainFrame())];

  for (const frame of frames) {
    try {
      const scriptExpr = `(${INJECT_SCRIPT.trim()})(${counter})`;
      const result = await frame.evaluate(scriptExpr) as ScriptResult | null;

      if (!result || !Array.isArray(result.elements)) continue;

      counter = result.nextCounter;
      if (frame === page.mainFrame()) viewportHeight = result.viewportHeight;

      for (const raw of result.elements as RawElement[]) {
        const el: ClickableElement = {
          nodeId: raw.refId,
          refId: raw.refId,
          role: raw.role,
          name: raw.name,
          value: raw.value,
          bounds: raw.bounds,
          isVisible: true,
          isDisabled: raw.isDisabled,
          isChecked: raw.isChecked,
          options: raw.options as SelectOption[] | undefined,
        };
        all.push(el);
      }

      log.debug({ frameUrl: frame.url(), count: result.elements.length }, 'Injected agent refs into frame');
    } catch (err) {
      log.debug({ frameUrl: frame.url(), err }, 'DOM injection failed for frame — skipping');
    }
  }

  return { elements: all, viewportHeight };
}
