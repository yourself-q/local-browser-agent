import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolExecutor, ToolContext, ExecutionResult } from '../types.js';

export const ScreenshotTool: ToolExecutor<{ savePath?: string }> = {
  name: 'screenshot',
  description: 'Capture a screenshot of the current page',

  async execute({ savePath }, ctx: ToolContext): Promise<ExecutionResult> {
    const start = Date.now();
    try {
      const buffer = await ctx.page.screenshot({ type: 'png', fullPage: false });
      const base64 = buffer.toString('base64');

      if (savePath) {
        writeFileSync(savePath, buffer);
      }

      return {
        success: true,
        action: 'screenshot',
        durationMs: Date.now() - start,
        output: { base64, savedTo: savePath },
      };
    } catch (err) {
      return { success: false, action: 'screenshot', durationMs: Date.now() - start, error: String(err) };
    }
  },
};
