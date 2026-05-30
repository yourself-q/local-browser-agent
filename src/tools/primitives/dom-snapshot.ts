import type { ToolExecutor, ToolContext, ExecutionResult } from '../types.js';
import { captureDOMSnapshot } from '../../state/dom.js';

export const DOMSnapshotTool: ToolExecutor<Record<never, never>> = {
  name: 'dom_snapshot',
  description: 'Capture the current DOM element index',

  async execute(_input, ctx: ToolContext): Promise<ExecutionResult> {
    const start = Date.now();
    try {
      const snapshot = await captureDOMSnapshot(ctx.page);
      return {
        success: true,
        action: 'dom_snapshot',
        durationMs: Date.now() - start,
        output: snapshot,
      };
    } catch (err) {
      return { success: false, action: 'dom_snapshot', durationMs: Date.now() - start, error: String(err) };
    }
  },
};
