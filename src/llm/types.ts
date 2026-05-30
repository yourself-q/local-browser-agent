import { z } from 'zod';

// ─── Action types ─────────────────────────────────────────────────────────────

export const ActionTypeSchema = z.enum([
  // Primitive browser actions
  'click',
  'type',
  'scroll',
  'hover',
  'navigate',
  'go_back',
  'go_forward',
  'reload',
  'switch_tab',
  'close_tab',
  'wait',
  'extract_content',
  'find_on_page',
  'screenshot',
  'accessibility_dump',
  'dom_snapshot',
  // Symbolic actions (decomposed at execution time)
  'submit_form',
  'close_modal',
  'login_flow',
  'open_search_result',
  // Agent tools (no browser interaction)
  'search',
  'execute_python',
  'execute_javascript',
  // Control flow
  'done',
  'fail',
]);

export type ActionType = z.infer<typeof ActionTypeSchema>;

// ─── Follow-up action (element of nextActions) ────────────────────────────────

/**
 * A lightweight follow-up action chained after the primary action.
 * No reasoning needed — all follow-ups reference elements from the same
 * state snapshot as the primary action.
 */
export const FollowUpActionSchema = z.object({
  action: ActionTypeSchema,
  targetElementId: z.string().nullish().transform((v) => v ?? undefined),
  targetDescription: z.string().nullish().transform((v) => v ?? undefined),
  value: z.string().nullish().transform((v) => v ?? undefined),
  scrollDirection: z.enum(['up', 'down', 'left', 'right']).nullish().transform((v) => v ?? undefined),
  scrollAmount: z.number().nullish().transform((v) => (v != null && v > 0 ? Math.round(v) : undefined)),
  tabIndex: z.number().int().min(0).nullish().transform((v) => v ?? undefined),
});
export type FollowUpAction = z.infer<typeof FollowUpActionSchema>;

// ─── Action decision (LLM output) ─────────────────────────────────────────────

export const ActionDecisionSchema = z.object({
  /** Chain-of-thought reasoning — always required */
  reasoning: z.string().min(1),
  /** The action to take */
  action: ActionTypeSchema,
  /** A11y nodeId from the current state's clickable elements */
  // nullish() = optional() + nullable() — LLMs often return null for omitted fields
  targetElementId: z.string().nullish().transform((v) => v ?? undefined),
  /** Human-readable description of the target element (grounding fallback) */
  targetDescription: z.string().nullish().transform((v) => v ?? undefined),
  /** For 'type' and 'navigate': the text or URL value */
  value: z.string().nullish().transform((v) => v ?? undefined),
  /** For 'scroll': direction */
  scrollDirection: z.enum(['up', 'down', 'left', 'right']).nullish().transform((v) => v ?? undefined),
  /** For 'scroll': pixel amount — coerce 0/null/undefined to undefined; keep positive values */
  scrollAmount: z.number().nullish().transform((v) => (v != null && v > 0 ? Math.round(v) : undefined)),
  /** For 'switch_tab': tab index */
  tabIndex: z.number().int().min(0).nullish().transform((v) => v ?? undefined),
  /** Confidence in the action choice (0.0–1.0) — optional, models often omit it */
  confidence: z.number().min(0).max(1).nullish().transform((v) => v ?? 0.5),
  /** Whether a human should approve this action before execution */
  requiresHumanApproval: z.boolean().default(false),
  /** Signal that the task is complete */
  done: z.boolean().default(false),
  /** Error description if LLM detected the task cannot proceed */
  error: z.string().nullish().transform((v) => v ?? undefined),
  /**
   * Optional fact to persist across steps.
   * The agent saves this to episodic memory automatically so it survives context window rotation.
   * Use for: credentials entered, important values found, key decisions made.
   * Example: "Entered email user@example.com into the login form"
   */
  remember: z.string().nullish().transform((v) => v ?? undefined),
  /**
   * Optional follow-up actions to execute immediately after this action completes,
   * without re-capturing page state between each.
   * All follow-ups reference ref_N IDs from the current step's Interactive Elements list.
   * Cancelled automatically if the primary action causes a URL change.
   * Maximum 3 follow-ups. Omit (or set null) when not needed.
   */
  nextActions: z.array(FollowUpActionSchema).max(3).nullish().transform((v) => v ?? undefined),
});

export type ActionDecision = z.infer<typeof ActionDecisionSchema>;

// ─── LLM response wrapper ─────────────────────────────────────────────────────

export interface LLMResponse {
  decision: ActionDecision;
  /** Raw model output before parsing */
  rawContent: string;
  /** Token usage if reported by the model */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Model temperature used */
  temperature: number;
}

// ─── LLM client interface ─────────────────────────────────────────────────────

export interface LLMClient {
  decide(
    state: import('../state/types.js').BrowserState,
    history: ConversationTurn[],
    task: string,
  ): Promise<LLMResponse>;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  /** Base64 PNG to send as image_url alongside content (for screenshot action results) */
  imageBase64?: string;
  stepIndex: number;
  timestamp: number;
}
