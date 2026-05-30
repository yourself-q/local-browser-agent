import OpenAI from 'openai';
import type { BrowserState } from '../state/types.js';
import type { LLMClient, LLMResponse, ConversationTurn, ActionDecision } from './types.js';
import { ActionDecisionSchema } from './types.js';
import { buildSystemPrompt } from '../prompts/system.js';
import { buildActionPrompt } from '../prompts/action.js';
import { createLogger } from '../runtime/logger.js';
import type { CustomTool } from '../tools/custom.js';

const log = createLogger('llm');

// ─── OpenAI-compatible LLM client ────────────────────────────────────────────

export interface OpenAILLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Refinement 5: deterministic mode — forces temperature=0, strict schema */
  deterministicMode: boolean;
  maxContextTurns: number;
  maxSteps: number;
  /**
   * Max tokens the model may generate.
   * Agent action JSON is small (~300 tokens), but Qwen3 thinking blocks can be
   * 500-2000 tokens. Budget 2048 to cover both.
   */
  maxTokens: number;
  /**
   * Qwen3 and some other models emit <think>...</think> blocks.
   * When true, strip them before JSON parsing.
   */
  stripThinkingBlocks: boolean;
  /**
   * Whether the model supports response_format: json_object.
   * Some LM Studio models do not respect this and will error.
   * Set to false to fall back to pure prompt-based JSON enforcement.
   */
  jsonMode: boolean;
  /**
   * Reference images passed via --data. Injected as image_url messages
   * at the start of every API call so they're always in context.
   */
  referenceImages?: Array<{ name: string; base64: string; mimeType: string }>;
  /** Custom tools injected by the MCP client — listed in system prompt. */
  customTools?: CustomTool[];
  /**
   * Optional HTTP-Referer header.
   * Required by OpenRouter to identify your app; ignored by other endpoints.
   */
  httpReferer?: string;
  /**
   * Optional X-Title header.
   * Shown in OpenRouter dashboard for usage tracking; ignored by other endpoints.
   */
  xTitle?: string;
}

export const DEFAULT_LLM_CONFIG: Partial<OpenAILLMConfig> = {
  maxTokens: 2048,
  stripThinkingBlocks: true,
  jsonMode: false,      // safer default — prompt-based JSON is more reliable with local models
  maxContextTurns: 20,
};

export class OpenAILLMClient implements LLMClient {
  private readonly client: OpenAI;
  private readonly config: OpenAILLMConfig;

  constructor(config: OpenAILLMConfig) {
    this.config = { ...DEFAULT_LLM_CONFIG, ...config } as OpenAILLMConfig;

    const extraHeaders: Record<string, string> = {};
    if (this.config.httpReferer) extraHeaders['HTTP-Referer'] = this.config.httpReferer;
    if (this.config.xTitle) extraHeaders['X-Title'] = this.config.xTitle;

    this.client = new OpenAI({
      baseURL: this.config.baseUrl,
      apiKey: this.config.apiKey,
      timeout: 1800000, // 30 min — Qwen3-35B deep reasoning can take 10-15 min on complex pages
      defaultHeaders: Object.keys(extraHeaders).length > 0 ? extraHeaders : undefined,
    });
  }

  async decide(
    state: BrowserState,
    history: ConversationTurn[],
    task: string,
    context = '',
  ): Promise<LLMResponse> {
    const systemPrompt = buildSystemPrompt(this.config.deterministicMode, this.config.customTools);
    const userPrompt = buildActionPrompt(
      task,
      state,
      context,
      state.stepIndex,
      this.config.maxSteps,
    );

    // Build the current-step user message.
    // If a screenshot is available, send it alongside the text so the model
    // can see the page visually (Qwen3 supports vision).
    const currentUserMessage: OpenAI.Chat.ChatCompletionMessageParam = state.screenshot
      ? {
          role: 'user',
          content: [
            { type: 'text', text: userPrompt },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${state.screenshot}` },
            },
          ],
        }
      : { role: 'user', content: userPrompt };

    // Reference images are prepended after the system prompt on every call.
    // A single assistant acknowledgment follows so the first history user message
    // doesn't create a consecutive-user-message violation (mergeConsecutiveMessages
    // still handles it if there are multiple images).
    const refImageMessages: OpenAI.Chat.ChatCompletionMessageParam[] = (this.config.referenceImages ?? [])
      .map((img) => ({
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: `[Reference image: ${img.name}]` },
          { type: 'image_url' as const, image_url: { url: `data:${img.mimeType};base64,${img.base64}` } },
        ],
      }));

    const refSection: OpenAI.Chat.ChatCompletionMessageParam[] =
      refImageMessages.length > 0
        ? [...refImageMessages, { role: 'assistant' as const, content: 'Reference image(s) noted.' }]
        : [];

    const historySlice = history.slice(-this.config.maxContextTurns);
    const rawMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...refSection,
      ...historySlice.map((turn, i): OpenAI.Chat.ChatCompletionMessageParam => {
        // Only attach screenshot to the most recent turn — older screenshots
        // eat tokens without aiding decisions (current state is what matters).
        const isLastTurn = i === historySlice.length - 1;
        if (isLastTurn && turn.imageBase64 && turn.role === 'user') {
          return {
            role: 'user',
            content: [
              { type: 'text', text: turn.content },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${turn.imageBase64}` } },
            ],
          };
        }
        return { role: turn.role, content: turn.content };
      }),
      currentUserMessage,
    ];

    // Qwen3's Jinja chat template requires strict user/assistant alternation.
    // Consecutive user messages (e.g. action result + next state) cause
    // "No user query found in messages." — merge them to comply.
    const messages = mergeConsecutiveMessages(rawMessages);

    const temperature = this.config.deterministicMode ? 0.0 : 0.3;

    // Estimate token usage for observability
    const estimatedInputTokens = estimateTokens(messages);

    log.debug(
      {
        model: this.config.model,
        temperature,
        messages: messages.length,
        estimatedInputTokens,
        maxTokens: this.config.maxTokens,
        deterministicMode: this.config.deterministicMode,
        jsonMode: this.config.jsonMode,
        stripThinking: this.config.stripThinkingBlocks,
      },
      'Calling LLM',
    );

    const startMs = Date.now();

    const requestParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: this.config.model,
      messages,
      temperature,
      max_tokens: this.config.maxTokens,
      stream: false,
    };

    // Only add response_format if JSON mode is explicitly enabled
    // (many local models silently fail or hallucinate when this is set)
    if (this.config.jsonMode) {
      requestParams.response_format = { type: 'json_object' };
    }

    const response = await this.client.chat.completions.create(requestParams);

    const elapsed = Date.now() - startMs;
    const choice = response.choices[0];
    let rawContent = choice?.message.content ?? '';

    // LM Studio separates thinking into reasoning_content (not part of OpenAI spec)
    // Log it for observability but don't parse it
    const reasoningContent = (choice?.message as unknown as Record<string, unknown>)?.['reasoning_content'];
    const reasoningTokens = (response.usage as unknown as Record<string, unknown>)?.['completion_tokens_details'];

    log.debug(
      {
        elapsed,
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
        rawContentLength: rawContent.length,
        hasReasoningContent: !!reasoningContent,
        reasoningTokens,
      },
      'LLM response received',
    );

    // Strip Qwen3 / DeepSeek thinking blocks if embedded in content
    // (LM Studio separates them into reasoning_content, but other servers embed them)
    if (this.config.stripThinkingBlocks) {
      rawContent = stripThinkingBlocks(rawContent);
    }

    const decision = parseDecision(rawContent);

    return {
      decision,
      rawContent,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
      temperature,
    };
  }
}

// ─── Thinking block stripper ──────────────────────────────────────────────────

/**
 * Strip <think>...</think> blocks emitted by Qwen3, DeepSeek-R1, etc.
 * These appear before the actual response content.
 *
 * Also strips the /think suffix that some Qwen3 variants add.
 */
export function stripThinkingBlocks(content: string): string {
  // Remove <think>...</think> blocks (possibly multi-line, possibly nested)
  let stripped = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // Some models use <|thinking|>...</|thinking|>
  stripped = stripped.replace(/<\|thinking\|>[\s\S]*?<\|\/thinking\|>/g, '').trim();

  // Remove /think suffix (Qwen3 non-thinking mode token)
  stripped = stripped.replace(/\/think\s*$/, '').trim();

  // Remove </think> without opening (partial stripping edge case)
  stripped = stripped.replace(/^<\/think>\s*/m, '').trim();

  return stripped;
}

// ─── Response parser ──────────────────────────────────────────────────────────

export function parseDecision(rawContent: string): ActionDecision {
  let parsed: unknown;

  // 1. Direct JSON parse
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    // 2. JSON inside markdown code block
    const mdMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (mdMatch?.[1]) {
      try {
        parsed = JSON.parse(mdMatch[1].trim());
      } catch {
        // fall through
      }
    }

    // 3. First JSON object in the string
    if (!parsed) {
      const objMatch = rawContent.match(/\{[\s\S]*\}/);
      if (objMatch?.[0]) {
        try {
          parsed = JSON.parse(objMatch[0]);
        } catch {
          // fall through
        }
      }
    }
  }

  if (!parsed) {
    log.error(
      { rawContent: rawContent.slice(0, 300) },
      'LLM returned unparseable response after thinking block stripping',
    );
    return {
      reasoning: 'LLM response could not be parsed',
      action: 'fail',
      confidence: 0,
      requiresHumanApproval: false,
      done: false,
      error: `Unparseable: ${rawContent.slice(0, 100)}`,
    };
  }

  const result = ActionDecisionSchema.safeParse(parsed);
  if (!result.success) {
    log.error({ errors: result.error.errors, parsed }, 'LLM response failed schema validation');
    const raw = parsed as Record<string, unknown>;
    return {
      reasoning: String(raw['reasoning'] ?? 'Schema validation failed'),
      action: 'fail',
      confidence: 0,
      requiresHumanApproval: false,
      done: false,
      error: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
    };
  }

  return result.data;
}

// ─── Message normalization ────────────────────────────────────────────────────

/**
 * Qwen3's Jinja chat template requires strict user/assistant alternation.
 * Consecutive messages with the same role cause a 400 "No user query found in messages."
 *
 * This function merges consecutive same-role messages into one:
 * - For user messages: concatenate text parts, preserve image_url blocks.
 * - For assistant messages: concatenate text.
 * - System messages are passed through as-is (always first, not duplicated).
 */
export function mergeConsecutiveMessages(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  for (const msg of messages) {
    const last = result[result.length - 1];

    if (last && last.role === msg.role && msg.role !== 'system') {
      // Merge into the last message of the same role.
      if (msg.role === 'user') {
        const lastUser = last as OpenAI.Chat.ChatCompletionUserMessageParam;
        const curUser = msg as OpenAI.Chat.ChatCompletionUserMessageParam;

        // Normalise both sides to the array form so we can append parts.
        const existingParts: OpenAI.Chat.ChatCompletionContentPart[] =
          typeof lastUser.content === 'string'
            ? [{ type: 'text', text: lastUser.content }]
            : [...(lastUser.content as OpenAI.Chat.ChatCompletionContentPart[])];

        const newParts: OpenAI.Chat.ChatCompletionContentPart[] =
          typeof curUser.content === 'string'
            ? [{ type: 'text', text: curUser.content }]
            : [...(curUser.content as OpenAI.Chat.ChatCompletionContentPart[])];

        // Separate existing text from images so we can append new text after it.
        const textParts = existingParts.filter((p) => p.type === 'text') as OpenAI.Chat.ChatCompletionContentPartText[];
        const imageParts = existingParts.filter((p) => p.type === 'image_url');
        const newTextParts = newParts.filter((p) => p.type === 'text') as OpenAI.Chat.ChatCompletionContentPartText[];
        const newImageParts = newParts.filter((p) => p.type === 'image_url');

        // Join text with a blank line separator, keep images at the end.
        const mergedText = [
          ...textParts.map((p) => p.text),
          ...newTextParts.map((p) => p.text),
        ].join('\n\n');

        const mergedParts: OpenAI.Chat.ChatCompletionContentPart[] = [
          { type: 'text', text: mergedText },
          ...imageParts,
          ...newImageParts,
        ];

        result[result.length - 1] = { role: 'user', content: mergedParts };
      } else if (msg.role === 'assistant') {
        const lastAsst = last as OpenAI.Chat.ChatCompletionAssistantMessageParam;
        const curAsst = msg as OpenAI.Chat.ChatCompletionAssistantMessageParam;
        const a = typeof lastAsst.content === 'string' ? lastAsst.content : '';
        const b = typeof curAsst.content === 'string' ? curAsst.content : '';
        result[result.length - 1] = { role: 'assistant', content: `${a}\n\n${b}` };
      } else {
        // Fallback: just push (shouldn't happen for system messages).
        result.push(msg);
      }
    } else {
      result.push(msg);
    }
  }

  return result;
}

// ─── Token estimation ─────────────────────────────────────────────────────────

/**
 * Rough token estimate: 1 token ≈ 4 chars for English, 2-3 chars for code/JSON.
 * Good enough for budget warnings — not for billing.
 */
function estimateTokens(messages: OpenAI.Chat.ChatCompletionMessageParam[]): number {
  const totalChars = messages.reduce((sum, m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return sum + content.length;
  }, 0);
  return Math.ceil(totalChars / 3.5);
}
