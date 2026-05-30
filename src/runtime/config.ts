import { z } from 'zod';
import { config as dotenvConfig } from 'dotenv';
import type { AgentConfig, ReferenceFile, CustomTool } from '../agent/types.js';

dotenvConfig();

// ─── Raw environment schema ───────────────────────────────────────────────────

const EnvSchema = z.object({
  // Use 127.0.0.1 — LM Studio rejects IPv6 (::1) connections that 'localhost' resolves to on macOS
  // Use 127.0.0.1 — LM Studio rejects IPv6 (::1) connections that 'localhost' resolves to on macOS
  // Context length: set to 32768 in LM Studio (32GB unified memory can handle it)
  LM_STUDIO_BASE_URL: z.string().url().default('http://127.0.0.1:1234/v1'),
  LM_STUDIO_API_KEY: z.string().default('lm-studio'),
  AGENT_MODEL: z.string().default('qwen3.6-35b-a3b-uncensored-hauhaucs-aggressive'),
  CHROME_DEBUGGING_PORT: z.coerce.number().int().default(9222),
  CHROME_DEBUGGING_HOST: z.string().default('127.0.0.1'), // avoid IPv6 (::1) on macOS
  SESSIONS_DIR: z.string().default('./sessions'),
  AGENT_MAX_STEPS: z.coerce.number().int().positive().default(50),
  // 35 min per step — LLM timeout is 30 min, step must be longer to let LLM finish
  AGENT_STEP_TIMEOUT_MS: z.coerce.number().int().positive().default(2100000),
  AGENT_MAX_RETRIES: z.coerce.number().int().min(0).default(15),
  DETERMINISTIC_MODE: z
    .string()
    .transform((v) => v === 'true' || v === '1')
    .default('false'),
  HUMAN_APPROVAL_MODE: z
    .string()
    .transform((v) => v === 'true' || v === '1')
    .default('false'),
  SCREENSHOT_MODE: z.enum(['always', 'on_failure', 'never']).default('always'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_PRETTY: z
    .string()
    .transform((v) => v === 'true' || v === '1')
    .default('true'),
  MCP_PORT: z.coerce.number().int().positive().default(3000),
  API_PORT: z.coerce.number().int().positive().default(8080),

  // LLM generation settings — all limits generous, 32GB unified memory
  AGENT_MAX_TOKENS: z.coerce.number().int().positive().default(8192),
  STRIP_THINKING_BLOCKS: z
    .string()
    .transform((v) => v !== 'false' && v !== '0')
    .default('true'),
  JSON_MODE: z
    .string()
    .transform((v) => v === 'true' || v === '1')
    .default('false'),

  // ── CAPTCHA / human intervention ─────────────────────────────────────────
  // How long to wait for the user to manually solve a CAPTCHA (ms).
  CAPTCHA_WAIT_TIMEOUT_MS: z.coerce.number().int().positive().default(300000), // 5 min

  // ── OpenRouter / API gateway headers (optional) ───────────────────────────
  // Recommended by OpenRouter: helps them understand usage and contact you if needed.
  OPENROUTER_REFERER: z.string().optional(),
  OPENROUTER_TITLE: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

// ─── Parsed environment singleton ─────────────────────────────────────────────

let _env: Env | undefined;

export function getEnv(): Env {
  if (!_env) {
    const result = EnvSchema.safeParse(process.env);
    if (!result.success) {
      const errors = result.error.errors
        .map((e) => `  ${e.path.join('.')}: ${e.message}`)
        .join('\n');
      throw new Error(`Invalid environment configuration:\n${errors}`);
    }
    _env = result.data;
  }
  return _env;
}

// ─── AgentConfig builder ──────────────────────────────────────────────────────

export interface AgentConfigOverrides {
  task: string;
  sessionId: string;
  humanApprovalMode?: boolean;
  deterministicMode?: boolean;
  maxSteps?: number;
  model?: string;
  chromePort?: number;
  referenceFiles?: ReferenceFile[];
  customTools?: CustomTool[];
}

export function buildAgentConfig(overrides: AgentConfigOverrides): AgentConfig {
  const env = getEnv();
  return {
    task: overrides.task,
    sessionId: overrides.sessionId,
    maxSteps: (overrides.maxSteps ?? env.AGENT_MAX_STEPS) as number,
    stepTimeoutMs: env.AGENT_STEP_TIMEOUT_MS as number,
    maxRetries: env.AGENT_MAX_RETRIES as number,
    humanApprovalMode: (overrides.humanApprovalMode ?? env.HUMAN_APPROVAL_MODE) as boolean,
    deterministicMode: (overrides.deterministicMode ?? env.DETERMINISTIC_MODE) as boolean,
    screenshotMode: env.SCREENSHOT_MODE as 'always' | 'on_failure' | 'never',
    model: (overrides.model ?? env.AGENT_MODEL) as string,
    lmStudioBaseUrl: env.LM_STUDIO_BASE_URL as string,
    lmStudioApiKey: env.LM_STUDIO_API_KEY as string,
    chromeDebuggingPort: (overrides.chromePort ?? env.CHROME_DEBUGGING_PORT) as number,
    chromeDebuggingHost: env.CHROME_DEBUGGING_HOST as string,
    sessionsDir: env.SESSIONS_DIR as string,
    maxTokens: env.AGENT_MAX_TOKENS as number,
    stripThinkingBlocks: env.STRIP_THINKING_BLOCKS as boolean,
    jsonMode: env.JSON_MODE as boolean,
    referenceFiles: overrides.referenceFiles,
    customTools: overrides.customTools,
    captchaWaitTimeoutMs: env.CAPTCHA_WAIT_TIMEOUT_MS as number,
    httpReferer: env.OPENROUTER_REFERER,
    xTitle: env.OPENROUTER_TITLE,
  };
}
