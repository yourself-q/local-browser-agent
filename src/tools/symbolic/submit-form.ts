import type { SymbolicAction, SymbolicActionContext } from './types.js';
import type { ExecutionResult } from '../types.js';
import { createLogger } from '../../runtime/logger.js';

const log = createLogger('tools:symbolic:submit-form');

interface SubmitFormInput {
  formSelector?: string;
  pressEnter?: boolean;
}

/**
 * Submit the active form.
 * Strategy: 1) Escape key for modals → 2) Find submit button → 3) Press Enter
 */
export const SubmitFormAction: SymbolicAction<SubmitFormInput> = {
  name: 'submit_form',
  description: 'Submit the current form by finding a submit button or pressing Enter',

  async execute({ formSelector, pressEnter = false }, ctx: SymbolicActionContext): Promise<ExecutionResult> {
    const start = Date.now();

    try {
      if (pressEnter) {
        await ctx.page.keyboard.press('Enter');
        return { success: true, action: 'submit_form', durationMs: Date.now() - start };
      }

      // Try to find a submit button in the form
      const form = formSelector
        ? ctx.page.locator(formSelector)
        : ctx.page.locator('form').first();

      const submitButton = form
        .locator('button[type="submit"], input[type="submit"], button:not([type])')
        .first();

      const count = await submitButton.count();
      if (count > 0) {
        await submitButton.click({ timeout: 5000 });
        log.debug('Clicked submit button');
        return { success: true, action: 'submit_form', durationMs: Date.now() - start };
      }

      // Fallback: press Enter
      await ctx.page.keyboard.press('Enter');
      log.debug('Submit button not found — pressed Enter');

      return { success: true, action: 'submit_form', durationMs: Date.now() - start };
    } catch (err) {
      return { success: false, action: 'submit_form', durationMs: Date.now() - start, error: String(err) };
    }
  },
};
