import type { StateDelta } from '../state/types.js';
import type { CustomTool } from '../tools/custom.js';

export type { CustomTool } from '../tools/custom.js';

// ─── Reference file ───────────────────────────────────────────────────────────

export interface ReferenceFile {
  name: string;
  /** 'image' for PNG/JPG/GIF/WebP — sent as image_url every step. 'text' — injected into context. */
  type: 'image' | 'text';
  /** Base64-encoded bytes for images; UTF-8 string for text files. */
  content: string;
  /** MIME type, e.g. 'image/png'. Only for images. */
  mimeType?: string;
}

// ─── Agent configuration ──────────────────────────────────────────────────────

export interface AgentConfig {
  task: string;
  sessionId: string;
  maxSteps: number;
  stepTimeoutMs: number;
  maxRetries: number;
  humanApprovalMode: boolean;
  /** When true: temperature=0, strict schemas, bounded iterations */
  deterministicMode: boolean;
  screenshotMode: 'always' | 'on_failure' | 'never';
  model: string;
  /** Max tokens the model may generate per step (default: 2048) */
  maxTokens: number;
  /** Strip Qwen3/DeepSeek <think>...</think> blocks (default: true) */
  stripThinkingBlocks: boolean;
  /** Use response_format: json_object (default: false — prompt-based is safer) */
  jsonMode: boolean;
  /** Files passed via --data. Text files go into task notes; images are sent every step. */
  referenceFiles?: ReferenceFile[];
  /** Custom tools injected via MCP client. Each becomes a new LLM action. */
  customTools?: CustomTool[];
  /** How long to wait for human input when wait_for_human is triggered (ms, default 5min) */
  captchaWaitTimeoutMs: number;
  /** Optional HTTP-Referer header for OpenRouter / API gateways */
  httpReferer?: string;
  /** Optional X-Title header for OpenRouter */
  xTitle?: string;
  lmStudioBaseUrl: string;
  lmStudioApiKey: string;
  chromeDebuggingPort: number;
  chromeDebuggingHost: string;
  sessionsDir: string;
}

// ─── Loop state ───────────────────────────────────────────────────────────────

export interface LoopState {
  stepIndex: number;
  consecutiveFailures: number;
  lastDelta?: StateDelta;
  done: boolean;
  failed: boolean;
  failureReason?: string;
}

// ─── Step result ──────────────────────────────────────────────────────────────

export type StepOutcome =
  | { type: 'success' }
  | { type: 'skipped'; reason: string }
  | { type: 'done' }
  | { type: 'failed'; reason: string; recoverable: boolean };

// ─── Verification ─────────────────────────────────────────────────────────────

export interface VerificationResult {
  passed: boolean;
  delta: StateDelta;
  /** What the verifier expected to see */
  expectedChange: string;
  /** What actually happened */
  observedChange: string;
}

// ─── Agent result ─────────────────────────────────────────────────────────────

export interface AgentResult {
  sessionId: string;
  task: string;
  stepsRun: number;
  success: boolean;
  summary: string;
  durationMs: number;
  failureReason?: string;
}
