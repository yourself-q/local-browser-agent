import type { ToolExecutor, ToolContext, ExecutionResult } from '../types.js';

export const NavigateTool: ToolExecutor<{
  url: string;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
}> = {
  name: 'navigate',
  description: 'Navigate to a URL',

  async execute({ url, waitUntil = 'networkidle' }, ctx: ToolContext): Promise<ExecutionResult> {
    const start = Date.now();
    try {
      // bringToFront() before navigating so Chrome shows this tab to the user.
      // Without this, navigation happens in a background tab and the user sees
      // nothing changing in their visible Chrome window.
      await ctx.page.bringToFront().catch(() => {});
      await ctx.page.goto(url, { waitUntil, timeout: 30000 });
      return { success: true, action: 'navigate', durationMs: Date.now() - start };
    } catch (err) {
      return { success: false, action: 'navigate', durationMs: Date.now() - start, error: String(err) };
    }
  },
};

export const GoBackTool: ToolExecutor<Record<never, never>> = {
  name: 'go_back',
  description: 'Navigate back in browser history',

  async execute(_input, ctx: ToolContext): Promise<ExecutionResult> {
    const start = Date.now();
    try {
      await ctx.page.goBack({ timeout: 10000 });
      return { success: true, action: 'go_back', durationMs: Date.now() - start };
    } catch (err) {
      return { success: false, action: 'go_back', durationMs: Date.now() - start, error: String(err) };
    }
  },
};

export const GoForwardTool: ToolExecutor<Record<never, never>> = {
  name: 'go_forward',
  description: 'Navigate forward in browser history',

  async execute(_input, ctx: ToolContext): Promise<ExecutionResult> {
    const start = Date.now();
    try {
      await ctx.page.goForward({ timeout: 10000 });
      return { success: true, action: 'go_forward', durationMs: Date.now() - start };
    } catch (err) {
      return { success: false, action: 'go_forward', durationMs: Date.now() - start, error: String(err) };
    }
  },
};

export const ReloadTool: ToolExecutor<Record<never, never>> = {
  name: 'reload',
  description: 'Reload the current page',

  async execute(_input, ctx: ToolContext): Promise<ExecutionResult> {
    const start = Date.now();
    try {
      await ctx.page.reload({ waitUntil: 'networkidle', timeout: 30000 });
      return { success: true, action: 'reload', durationMs: Date.now() - start };
    } catch (err) {
      return { success: false, action: 'reload', durationMs: Date.now() - start, error: String(err) };
    }
  },
};
