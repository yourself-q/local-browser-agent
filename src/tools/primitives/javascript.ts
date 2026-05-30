import type { ToolExecutor, ToolContext, ExecutionResult } from '../types.js';

/**
 * Execute JavaScript in the page context (emergency escape hatch).
 *
 * Mirrors open-claude-in-chrome's javascript_tool.
 * Use when normal grounding + click fails (e.g. overlays, synthetic event issues).
 *
 * Rules (same as reference impl):
 * - Write an expression, not a statement — no `return` keyword needed
 * - Result is JSON-serialized and returned as output
 * - Throws are caught and returned as errors
 *
 * Example: document.querySelector('button.saiten').click()
 */
export const JavascriptTool: ToolExecutor<{ code: string }> = {
  name: 'execute_javascript',
  description: 'Execute a JavaScript expression in the page context',

  async execute({ code }, ctx: ToolContext): Promise<ExecutionResult> {
    const start = Date.now();

    if (!code?.trim()) {
      return {
        success: false,
        action: 'execute_javascript',
        durationMs: Date.now() - start,
        error: 'No code provided',
      };
    }

    try {
      // Wrap in arrow function so the model can write expressions freely
      // (no return statement needed, just like the reference impl)
      const result = await ctx.page.evaluate((js: string) => {
        // eslint-disable-next-line no-new-func
        const fn = new Function(js);
        return fn();
      }, code);

      const output = result !== undefined ? JSON.stringify(result) : '(no return value)';

      return {
        success: true,
        action: 'execute_javascript',
        durationMs: Date.now() - start,
        output,
      };
    } catch (err) {
      return {
        success: false,
        action: 'execute_javascript',
        durationMs: Date.now() - start,
        error: String(err),
      };
    }
  },
};
