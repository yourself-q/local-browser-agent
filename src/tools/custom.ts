import { z } from 'zod';

// ─── Custom tool definition ───────────────────────────────────────────────────

export const CustomToolSchema = z.object({
  /**
   * Action name the LLM will use (e.g. "fill_company_field").
   * Must be lowercase, start with a letter, max 50 chars, underscores allowed.
   */
  name: z
    .string()
    .regex(
      /^[a-z][a-z0-9_]{0,49}$/,
      'Tool name must be lowercase, start with a letter, max 50 chars, only a-z/0-9/_',
    ),
  /** One-line description shown to the LLM in the system prompt. */
  description: z.string().min(1).max(500),
  /**
   * JavaScript template executed in the page context.
   * Use ${value} as the placeholder for the LLM-supplied value.
   * Example: "document.querySelector('#company').value = '${value}';"
   */
  jsTemplate: z.string().min(1).max(10000),
});

export type CustomTool = z.infer<typeof CustomToolSchema>;

// ─── JS template rendering ────────────────────────────────────────────────────

/**
 * Escape a user-supplied string for safe interpolation into a JS string literal.
 * This prevents the LLM's value from breaking out of the template's string context.
 */
export function escapeForJSString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/`/g, '\\`')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/</g, '\\x3c')
    .replace(/>/g, '\\x3e');
}

/** Substitute ${value} in the template with the escaped value. */
export function renderJsTemplate(template: string, value: string): string {
  return template.replace(/\$\{value\}/g, escapeForJSString(value));
}
