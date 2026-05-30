import type { ToolExecutor, ToolContext, ExecutionResult } from '../types.js';
import type { GroundedElement } from '../../grounding/types.js';

export const TypeTool: ToolExecutor<{
  element?: GroundedElement;
  text: string;
  clearFirst?: boolean;
  pressEnterAfter?: boolean;
  delayMs?: number;
}> = {
  name: 'type',
  description: 'Type text into a grounded input element',

  async execute({ element, text, clearFirst = false, pressEnterAfter = false, delayMs = 10 }, ctx: ToolContext): Promise<ExecutionResult> {
    const start = Date.now();

    if (!element) {
      return { success: false, action: 'type', durationMs: Date.now() - start, error: 'No element' };
    }

    try {
      // ── <select> elements: use setFormValue logic (mirrors reference impl) ────
      //
      // Reference: open-claude-in-chrome setFormValue() for <select>:
      //   finds matching option by value OR textContent, sets target.value,
      //   then dispatches input + change events with { bubbles: true, composed: true }.
      //
      // locator.evaluate() runs in the element's own frame — iframe-safe.
      // This bypasses the OS-native dropdown entirely (no clicking needed).
      const isSelect = await element.locator.evaluate((el: Element) => {
        return el.tagName.toLowerCase() === 'select' ||
          (el.querySelector('select') !== null);
      }).catch(() => false);

      if (isSelect) {
        const selectResult = await element.locator.evaluate((el: Element, val: string) => {
          const target = (el.tagName.toLowerCase() === 'select'
            ? el
            : el.querySelector('select')) as HTMLSelectElement | null;
          if (!target) return { success: false, error: 'No <select> found' };

          const opt = Array.from(target.options).find(
            (o) => o.value === val || o.textContent.trim() === val,
          );
          if (opt) {
            target.value = opt.value;
          } else {
            // Fallback: set directly (may not match any option but worth trying)
            target.value = val;
          }

          target.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          target.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          return { success: true, selected: target.value };
        }, text).catch((err: unknown) => ({ success: false, error: String(err) }));

        if (selectResult.success) {
          return {
            success: true,
            action: 'type',
            durationMs: Date.now() - start,
            output: `Selected option: "${text}"`,
          };
        }
        // Fall through to input handling if select handling failed
      }

      // ── input / textarea / contentEditable: native setter + events ───────────
      //
      // Reference: open-claude-in-chrome setFormValue() for input/textarea:
      //   scrollIntoView → native prototype setter → dispatch input + change events.
      // This is more reliable than pressSequentially for React/Vue/Angular inputs
      // because it triggers the framework's change-detection listeners directly.
      const result = await element.locator.evaluate((el: Element, args: { val: string; clear: boolean }) => {
        el.scrollIntoView({ block: 'center', behavior: 'instant' });

        // contentEditable handling
        const ce = el as HTMLElement;
        if (ce.contentEditable === 'true') {
          if (args.clear) ce.textContent = '';
          ce.textContent = (ce.textContent ?? '') + args.val;
          ce.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          ce.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          return { success: true, value: ce.textContent ?? '' };
        }

        // Inline: find input/textarea inside element or shadow DOM
        // (avoids named inner functions that esbuild transforms to __name(...) — not available in browser context)
        let target: HTMLInputElement | HTMLTextAreaElement | null = null;
        const elTag = el.tagName.toLowerCase();
        if (elTag === 'input' || elTag === 'textarea') {
          target = el as HTMLInputElement | HTMLTextAreaElement;
        } else {
          target = el.querySelector('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null;
          if (!target && el.shadowRoot) {
            target = el.shadowRoot.querySelector('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null;
          }
        }

        if (!target) return { success: false, error: 'No input/textarea found inside element' };

        const inputTag = target.tagName.toLowerCase();
        const proto = inputTag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        const newVal = args.clear ? args.val : (target.value ?? '') + args.val;
        if (setter) {
          setter.call(target, newVal);
        } else {
          target.value = newVal;
        }

        target.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        target.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        return { success: true, value: target.value };
      }, { val: text, clear: clearFirst }).catch((err: unknown) => ({ success: false, error: String(err) }));

      if (!result.success) {
        return { success: false, action: 'type', durationMs: Date.now() - start, error: result.error ?? 'Input failed' };
      }

      // ── Optional Enter ────────────────────────────────────────────────────────
      if (pressEnterAfter) {
        await ctx.page.keyboard.press('Enter');
      }

      return {
        success: true,
        action: 'type',
        durationMs: Date.now() - start,
        output: `Typed: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`,
      };
    } catch (err) {
      return { success: false, action: 'type', durationMs: Date.now() - start, error: String(err) };
    }
  },
};
