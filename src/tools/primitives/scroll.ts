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
        // Move mouse to viewport center then fire wheel — browser hit-test finds
        // the correct scroll container regardless of page layout.
        // viewportSize() returns null on CDP connections, fall back to JS.
        const vp = ctx.page.viewportSize()
          ?? await ctx.page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
        await ctx.page.mouse.move(vp.width / 2, vp.height / 2);
        await ctx.page.mouse.wheel(deltaX, deltaY);
      }

      // Brief wait for scroll animations
      await ctx.page.waitForTimeout(300);

      const scrollY = await ctx.page.evaluate(() =>
        window.scrollY || (document.scrollingElement?.scrollTop ?? 0),
      );
      return { success: true, action: 'scroll', durationMs: Date.now() - start, output: `Scrolled. Current scrollY: ${scrollY}px` };
    } catch (err) {
      return { success: false, action: 'scroll', durationMs: Date.now() - start, error: String(err) };
    }
  },
};
