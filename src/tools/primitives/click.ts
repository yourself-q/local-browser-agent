import type { ToolExecutor, ToolContext, ExecutionResult } from '../types.js';
import type { GroundedElement } from '../../grounding/types.js';

export const ClickTool: ToolExecutor<{ element?: GroundedElement; button?: 'left' | 'right' | 'middle' }> = {
  name: 'click',
  description: 'Click on a grounded element using CDP coordinates (bounding-rect center)',

  async execute({ element, button = 'left' }, ctx: ToolContext): Promise<ExecutionResult> {
    const start = Date.now();

    if (!element) {
      return {
        success: false,
        action: 'click',
        durationMs: Date.now() - start,
        error: 'No element to click — grounding must be performed first',
      };
    }

    try {
      // ── Radio / Checkbox: JS click via locator.evaluate() ─────────────────────
      //
      // Reference: noemica-io/open-claude-in-chrome / extension/content.js
      //   setFormValue() for radio/checkbox calls target.click() inside the content
      //   script which runs in the ELEMENT'S OWN FRAME (all_frames: true).
      //
      // Critical: page.evaluate((el) => el.click(), handle) runs in the MAIN FRAME
      // and cannot access elements inside iframes — silently does nothing.
      // locator.evaluate() runs in the frame that owns the element, same as
      // the content-script-per-frame approach. This is the correct equivalent.
      //
      // Why JS click for radio/checkbox (not CDP mouse):
      //   - Styled radios are usually display:none — no visible hit target
      //   - JS click() reliably fires checked + change events for server-side state
      //   - No coordinate guessing / label-hunting needed

      const inputType = await element.locator.evaluate((el: Element): string | null => {
        // Runs in the element's own frame — works for iframes too
        const findInput = (root: Element): HTMLInputElement | null => {
          if (root.tagName === 'INPUT') {
            const t = (root as HTMLInputElement).type.toLowerCase();
            return t === 'radio' || t === 'checkbox' ? (root as HTMLInputElement) : null;
          }
          return root.querySelector<HTMLInputElement>('input[type="radio"], input[type="checkbox"]');
        };
        const inp = findInput(el);
        return inp ? inp.type.toLowerCase() : null;
      }).catch(() => null);

      if (inputType === 'radio' || inputType === 'checkbox') {
        await element.locator.evaluate((el: Element) => {
          // Also runs in element's frame — mirrors content script injection
          const findInput = (root: Element): HTMLElement => {
            if (root.tagName === 'INPUT') return root as HTMLElement;
            return (
              root.querySelector<HTMLInputElement>('input[type="radio"], input[type="checkbox"]') ??
              (root as HTMLElement)
            );
          };
          const input = findInput(el);
          // Scroll into view first (reference impl scrolls before clicking)
          input.scrollIntoView({ block: 'center', behavior: 'instant' });
          input.click();
        });

        return {
          success: true,
          action: 'click',
          durationMs: Date.now() - start,
          output: `JS click on ${inputType} element`,
        };
      }

      // ── All other elements: CDP coordinate click ───────────────────────────────
      //
      // Reference: open-claude-in-chrome mouseClick()
      //   mouseMoved → mousePressed (50ms) → mouseReleased
      //
      // scrollIntoView via locator.evaluate() — runs in element's frame.
      // locator.boundingBox() already returns viewport-relative coords
      // correctly even for iframe-hosted elements.

      await element.locator.evaluate((el: Element) => {
        // In element's own frame — scrolls within the correct document
        (el as HTMLElement).scrollIntoView({ block: 'center', behavior: 'instant' });
      }).catch(() => {});

      // Brief pause for scroll to settle before measuring
      await ctx.page.waitForTimeout(100);

      const box = await element.locator.boundingBox();

      let cx: number;
      let cy: number;

      if (box && box.width > 0 && box.height > 0) {
        cx = box.x + box.width / 2;
        cy = box.y + box.height / 2;
      } else if (element.strategy === 'vision') {
        // Vision grounding provides bounding box directly
        cx = element.bounds.x + element.bounds.width / 2;
        cy = element.bounds.y + element.bounds.height / 2;
      } else {
        // Element has no visible bounding box (e.g. styled wrapper with no size).
        // Try: label[for=id] → parent label → nearest visible ancestor.
        // locator.evaluate() runs in element's frame so querySelector works correctly.
        const fallbackBox = await element.locator.evaluate((el: Element) => {
          // 1. label[for=id]
          const id = (el as HTMLElement).id;
          let target: Element | null = null;
          if (id) {
            // CSS.escape may not exist in older pages — guard it
            try {
              target = document.querySelector(`label[for="${CSS.escape(id)}"]`);
            } catch {
              target = document.querySelector(`label[for="${id}"]`);
            }
          }
          // 2. parent <label>
          if (!target) target = el.closest('label');
          // 3. nearest visible ancestor
          if (!target) {
            let parent = el.parentElement;
            while (parent) {
              const style = window.getComputedStyle(parent);
              if (style.display !== 'none' && style.visibility !== 'hidden') {
                target = parent;
                break;
              }
              parent = parent.parentElement;
            }
          }
          if (!target) return null;
          const rect = target.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return null;
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }).catch(() => null);

        if (!fallbackBox) {
          return {
            success: false,
            action: 'click',
            durationMs: Date.now() - start,
            error: 'Cannot determine click coordinates — element and all ancestors are hidden',
          };
        }

        cx = fallbackBox.x + fallbackBox.width / 2;
        cy = fallbackBox.y + fallbackBox.height / 2;
      }

      // ── CDP mouse click (reference: open-claude-in-chrome mouseClick) ─────────
      await ctx.page.mouse.move(cx!, cy!);
      await ctx.page.mouse.click(cx!, cy!, { button, delay: 50 });

      return {
        success: true,
        action: 'click',
        durationMs: Date.now() - start,
        output: `Clicked at (${Math.round(cx!)}, ${Math.round(cy!)})`,
      };
    } catch (err) {
      return {
        success: false,
        action: 'click',
        durationMs: Date.now() - start,
        error: String(err),
      };
    }
  },
};
