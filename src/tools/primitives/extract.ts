import type { ToolExecutor, ToolContext, ExecutionResult } from '../types.js';

export const ExtractContentTool: ToolExecutor<{
  selector?: string;
  format?: 'text' | 'markdown' | 'html';
}> = {
  name: 'extract_content',
  description: 'Extract text content from the page or a specific element',

  async execute({ selector, format = 'text' }, ctx: ToolContext): Promise<ExecutionResult> {
    const start = Date.now();
    try {
      let content: string;

      if (format === 'html') {
        content = await ctx.page.evaluate((sel) => {
          const el = sel ? document.querySelector(sel) : document.body;
          return el?.outerHTML ?? '';
        }, selector ?? null);
      } else {
        content = await ctx.page.evaluate((sel) => {
          const el = sel ? document.querySelector(sel) : document.body;
          return (el as HTMLElement)?.innerText ?? el?.textContent ?? '';
        }, selector ?? null);
      }

      return {
        success: true,
        action: 'extract_content',
        durationMs: Date.now() - start,
        output: content,
      };
    } catch (err) {
      return { success: false, action: 'extract_content', durationMs: Date.now() - start, error: String(err) };
    }
  },
};
