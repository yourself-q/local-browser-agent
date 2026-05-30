import type { SymbolicAction, SymbolicActionContext } from './types.js';
import type { ExecutionResult } from '../types.js';
import { createLogger } from '../../runtime/logger.js';

const log = createLogger('tools:symbolic:close-modal');

interface CloseModalInput {
  strategy?: 'escape' | 'button' | 'auto';
}

export const CloseModalAction: SymbolicAction<CloseModalInput> = {
  name: 'close_modal',
  description: 'Close a modal dialog using Escape or a close button',

  async execute({ strategy = 'auto' }, ctx: SymbolicActionContext): Promise<ExecutionResult> {
    const start = Date.now();

    try {
      if (strategy === 'escape' || strategy === 'auto') {
        await ctx.page.keyboard.press('Escape');
        await ctx.page.waitForTimeout(300);

        // Check if modal is gone
        const dialogCount = await ctx.page.locator('[role="dialog"],[role="alertdialog"]').count();
        if (dialogCount === 0) {
          log.debug('Modal closed via Escape');
          return { success: true, action: 'close_modal', durationMs: Date.now() - start };
        }
      }

      if (strategy === 'button' || strategy === 'auto') {
        // Look for close button candidates
        const closeBtn = ctx.page
          .locator(
            '[aria-label*="close" i], [aria-label*="dismiss" i], button:has-text("Close"), button:has-text("Cancel"), button:has-text("×")',
          )
          .first();

        const count = await closeBtn.count();
        if (count > 0) {
          await closeBtn.click({ timeout: 5000 });
          log.debug('Modal closed via close button');
          return { success: true, action: 'close_modal', durationMs: Date.now() - start };
        }
      }

      return {
        success: false,
        action: 'close_modal',
        durationMs: Date.now() - start,
        error: 'Could not find a way to close the modal',
      };
    } catch (err) {
      return { success: false, action: 'close_modal', durationMs: Date.now() - start, error: String(err) };
    }
  },
};
