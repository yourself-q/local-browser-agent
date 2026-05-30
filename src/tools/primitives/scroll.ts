import type { ToolExecutor, ToolContext, ExecutionResult } from '../types.js';
import type { GroundedElement } from '../../grounding/types.js';

export const ScrollTool: ToolExecutor<{
  direction: 'up' | 'down' | 'left' | 'right';
  amount?: number;
  element?: GroundedElement;
}> = {
  name: 'scroll',
  description: 'Scroll the page or a specific element',

  async execute({ direction, amount = 300, element }, ctx: ToolContext): Promise<ExecutionResult> {
    const start = Date.now();

    const deltaX = direction === 'right' ? amount : direction === 'left' ? -amount : 0;
    const deltaY = direction === 'down' ? amount : direction === 'up' ? -amount : 0;

    try {
      if (element && element.strategy !== 'vision') {
        await element.locator.evaluate(
          (el, { dx, dy }) => el.scrollBy(dx, dy),
          { dx: deltaX, dy: deltaY },
        );
      } else {
        await ctx.page.mouse.wheel(deltaX, deltaY);
      }

      // Brief wait for scroll animations
      await ctx.page.waitForTimeout(300);

      return { success: true, action: 'scroll', durationMs: Date.now() - start };
    } catch (err) {
      return { success: false, action: 'scroll', durationMs: Date.now() - start, error: String(err) };
    }
  },
};
