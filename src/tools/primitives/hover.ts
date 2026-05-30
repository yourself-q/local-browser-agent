import type { ToolExecutor, ToolContext, ExecutionResult } from '../types.js';
import type { GroundedElement } from '../../grounding/types.js';

export const HoverTool: ToolExecutor<{ element?: GroundedElement }> = {
  name: 'hover',
  description: 'Hover over a grounded element',

  async execute({ element }, ctx: ToolContext): Promise<ExecutionResult> {
    const start = Date.now();
    if (!element) {
      return { success: false, action: 'hover', durationMs: Date.now() - start, error: 'No element' };
    }
    try {
      if (element.strategy === 'vision') {
        const cx = element.bounds.x + element.bounds.width / 2;
        const cy = element.bounds.y + element.bounds.height / 2;
        await ctx.page.mouse.move(cx, cy);
      } else {
        await element.locator.hover({ timeout: 5000 });
      }
      await ctx.page.waitForTimeout(200);
      return { success: true, action: 'hover', durationMs: Date.now() - start };
    } catch (err) {
      return { success: false, action: 'hover', durationMs: Date.now() - start, error: String(err) };
    }
  },
};
