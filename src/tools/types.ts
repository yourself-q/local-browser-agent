import { z } from 'zod';
import type { ActionType } from '../llm/types.js';

// ─── Execution result ─────────────────────────────────────────────────────────

export interface ExecutionResult {
  success: boolean;
  action: ActionType;
  /** Milliseconds to execute */
  durationMs: number;
  /** Error message if failed */
  error?: string;
  /** Extra data produced (e.g., extracted text, screenshot path) */
  output?: unknown;
}

// ─── Primitive tool schemas (Zod) ─────────────────────────────────────────────

export const ClickInputSchema = z.object({
  elementId: z.string().optional(),
  selector: z.string().optional(),
  button: z.enum(['left', 'right', 'middle']).default('left'),
  modifiers: z.array(z.enum(['Alt', 'Control', 'Meta', 'Shift'])).default([]),
  /** Use coordinates only as absolute last resort */
  position: z.object({ x: z.number(), y: z.number() }).optional(),
});
export type ClickInput = z.infer<typeof ClickInputSchema>;

export const TypeInputSchema = z.object({
  elementId: z.string().optional(),
  selector: z.string().optional(),
  text: z.string(),
  clearFirst: z.boolean().default(false),
  pressEnterAfter: z.boolean().default(false),
  delayMs: z.number().int().min(0).default(0),
});
export type TypeInput = z.infer<typeof TypeInputSchema>;

export const ScrollInputSchema = z.object({
  direction: z.enum(['up', 'down', 'left', 'right']),
  amount: z.number().int().positive().default(300),
  elementId: z.string().optional(),
  selector: z.string().optional(),
});
export type ScrollInput = z.infer<typeof ScrollInputSchema>;

export const HoverInputSchema = z.object({
  elementId: z.string().optional(),
  selector: z.string().optional(),
});
export type HoverInput = z.infer<typeof HoverInputSchema>;

export const NavigateInputSchema = z.object({
  url: z.string().url(),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle', 'commit']).default('networkidle'),
});
export type NavigateInput = z.infer<typeof NavigateInputSchema>;

export const SwitchTabInputSchema = z.object({
  tabIndex: z.number().int().min(0),
});
export type SwitchTabInput = z.infer<typeof SwitchTabInputSchema>;

export const WaitInputSchema = z.object({
  ms: z.number().int().positive().max(30000).default(1000),
});
export type WaitInput = z.infer<typeof WaitInputSchema>;

export const ExtractContentInputSchema = z.object({
  selector: z.string().optional(),
  format: z.enum(['text', 'markdown', 'html']).default('text'),
});
export type ExtractContentInput = z.infer<typeof ExtractContentInputSchema>;

// ─── Symbolic action schemas ──────────────────────────────────────────────────

export const SubmitFormInputSchema = z.object({
  formSelector: z.string().optional(),
  /** Press Enter on the active field instead of finding a submit button */
  pressEnter: z.boolean().default(false),
});
export type SubmitFormInput = z.infer<typeof SubmitFormInputSchema>;

export const CloseModalInputSchema = z.object({
  /** Try Escape key first, then look for close button */
  strategy: z.enum(['escape', 'button', 'auto']).default('auto'),
});
export type CloseModalInput = z.infer<typeof CloseModalInputSchema>;

// ─── Tool interface ───────────────────────────────────────────────────────────

export interface ToolExecutor<TInput = unknown> {
  name: string;
  description: string;
  execute(input: TInput, context: ToolContext): Promise<ExecutionResult>;
}

export interface ToolContext {
  page: import('playwright').Page;
  sessionId: string;
  stepIndex: number;
}
