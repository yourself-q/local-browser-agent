import type { ToolContext } from '../types.js';
import type { ExecutionResult } from '../types.js';

export interface FindOnPageInput {
  pattern: string;
  contextChars?: number;
  maxMatches?: number;
}

// ─── Find-on-page tool ────────────────────────────────────────────────────────

export class FindOnPageTool {
  static async execute(
    { pattern, contextChars = 120, maxMatches = 10 }: FindOnPageInput,
    ctx: ToolContext,
  ): Promise<ExecutionResult> {
    const start = Date.now();
    try {
      const text: string = await ctx.page.evaluate(
        () => (document.body as HTMLElement).innerText ?? '',
      );

      if (!pattern.trim()) {
        return { success: false, action: 'find_on_page', durationMs: Date.now() - start, error: 'Empty search pattern' };
      }

      // Support /pattern/flags literal syntax; otherwise treat as literal text
      const regexLiteral = pattern.match(/^\/(.+)\/([gimsuy]*)$/);
      let regex: RegExp;
      try {
        regex = regexLiteral
          ? new RegExp(regexLiteral[1]!, regexLiteral[2] ?? 'gi')
          : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      } catch {
        return { success: false, action: 'find_on_page', durationMs: Date.now() - start, error: `Invalid regex: ${pattern}` };
      }

      const matches: Array<{ match: string; context: string }> = [];
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text)) !== null && matches.length < maxMatches) {
        const lo = Math.max(0, m.index - contextChars);
        const hi = Math.min(text.length, m.index + m[0].length + contextChars);
        matches.push({ match: m[0], context: text.slice(lo, hi).replace(/\s+/g, ' ').trim() });
        // Prevent infinite loop on zero-length matches
        if (m[0].length === 0) regex.lastIndex++;
      }

      const output =
        matches.length === 0
          ? `No matches found for: ${pattern}`
          : `Found ${matches.length} match(es) for "${pattern}":\n\n` +
            matches.map((m, i) => `[${i + 1}] …${m.context}…`).join('\n\n');

      return { success: true, action: 'find_on_page', durationMs: Date.now() - start, output };
    } catch (err) {
      return { success: false, action: 'find_on_page', durationMs: Date.now() - start, error: String(err) };
    }
  }
}
