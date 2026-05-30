import type { ToolExecutor, ToolContext, ExecutionResult } from '../types.js';
import { captureAccessibilityTree } from '../../state/accessibility.js';

export const AccessibilityDumpTool: ToolExecutor<{ format?: 'json' | 'text' }> = {
  name: 'accessibility_dump',
  description: 'Dump the current accessibility tree',

  async execute({ format = 'json' }, ctx: ToolContext): Promise<ExecutionResult> {
    const start = Date.now();
    try {
      const result = await captureAccessibilityTree(ctx.page);

      // Strip nodeId from JSON output — internal hashes confuse the LLM into
      // using them as targetElementId instead of the ref_N IDs in the action prompt.
      const output =
        format === 'json'
          ? JSON.stringify(stripNodeIds(result.tree), null, 2)
          : formatTreeAsText(result.tree);

      return {
        success: true,
        action: 'accessibility_dump',
        durationMs: Date.now() - start,
        output: { tree: output, treeHash: result.treeHash, count: result.clickableElements.length },
      };
    } catch (err) {
      return { success: false, action: 'accessibility_dump', durationMs: Date.now() - start, error: String(err) };
    }
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stripNodeIds(node: import('../../state/types.js').AccessibilityNode): any {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { nodeId: _ignored, children, ...rest } = node;
  return { ...rest, children: children.map(stripNodeIds) };
}

function formatTreeAsText(node: import('../../state/types.js').AccessibilityNode, depth = 0): string {
  const indent = '  '.repeat(depth);
  const label = node.name ? `"${node.name}"` : '';
  const interactive = node.isInteractive ? ' [interactive]' : '';
  const disabled = node.isDisabled ? ' [disabled]' : '';
  const value = node.value ? ` = ${node.value}` : '';
  // NOTE: nodeId intentionally omitted — internal hash IDs confuse the LLM into
  // using them as targetElementId. Use ref_N IDs from the clickableElements list instead.
  let text = `${indent}${node.role} ${label}${value}${interactive}${disabled}\n`;
  for (const child of node.children) {
    text += formatTreeAsText(child, depth + 1);
  }
  return text;
}
