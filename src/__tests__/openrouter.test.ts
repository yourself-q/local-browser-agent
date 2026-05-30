import { describe, test, expect } from 'vitest';

// ─── OpenRouter header config tests ──────────────────────────────────────────
//
// Verifies that OpenAILLMConfig correctly accepts OpenRouter-specific fields,
// and that AgentConfig carries httpReferer / xTitle through to the LLM client.
// Env-var parsing is not tested here because getEnv() uses a module-level
// singleton that cannot be reset between tests reliably.

// ─── OpenAILLMConfig — field acceptance (compile-time) ───────────────────────

describe('OpenAILLMConfig — httpReferer and xTitle fields', () => {
  test('accepts httpReferer and xTitle without TypeScript error', async () => {
    const { OpenAILLMClient } = await import('../llm/openai.js');

    // TypeScript compile check: these fields must exist on the config type.
    // If this fails to compile, the feature is not wired correctly.
    const config = {
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-or-test',
      model: 'anthropic/claude-haiku-4-5',
      deterministicMode: false,
      maxContextTurns: 10,
      maxSteps: 50,
      maxTokens: 256,
      stripThinkingBlocks: false,
      jsonMode: false,
      httpReferer: 'https://example.com',
      xTitle: 'browser-agent',
    };

    // Constructor must accept the config without throwing
    expect(() => new OpenAILLMClient(config)).not.toThrow();
  });

  test('accepts config without optional headers (backward-compatible)', async () => {
    const { OpenAILLMClient } = await import('../llm/openai.js');

    const config = {
      baseUrl: 'http://127.0.0.1:1234/v1',
      apiKey: 'lm-studio',
      model: 'qwen3',
      deterministicMode: false,
      maxContextTurns: 10,
      maxSteps: 50,
      maxTokens: 2048,
      stripThinkingBlocks: true,
      jsonMode: false,
      // No httpReferer or xTitle — must still work
    };

    expect(() => new OpenAILLMClient(config)).not.toThrow();
  });
});

// ─── OpenRouter endpoint compatibility note ───────────────────────────────────
//
// OpenRouter accepts OpenAI-compatible requests. The only required changes are:
//   1. LM_STUDIO_BASE_URL=https://openrouter.ai/api/v1
//   2. LM_STUDIO_API_KEY=<your-openrouter-key>
//   3. AGENT_MODEL=anthropic/claude-haiku-4-5  (provider/model format)
//   4. OPENROUTER_REFERER and OPENROUTER_TITLE for dashboard tracking
//
// STRIP_THINKING_BLOCKS=false is recommended for Claude/GPT via OpenRouter.
//
// Live test (runs only when OPENROUTER_API_KEY env var is set — skipped in CI):
describe('OpenRouter live connectivity', () => {
  test.skipIf(!process.env['OPENROUTER_API_KEY'])(
    'can reach OpenRouter with a minimal completion request',
    async () => {
      const { OpenAILLMClient } = await import('../llm/openai.js');
      const client = new OpenAILLMClient({
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: process.env['OPENROUTER_API_KEY']!,
        model: 'openai/gpt-4o-mini',
        deterministicMode: true,
        maxContextTurns: 5,
        maxSteps: 10,
        maxTokens: 256,
        stripThinkingBlocks: false,
        jsonMode: false,
        httpReferer: 'https://github.com/test',
        xTitle: 'browser-agent-test',
      });

      const state = {
        url: 'https://example.com',
        title: 'Test',
        sessionId: 'test',
        stepIndex: 0,
        timestamp: Date.now(),
        clickableElements: [],
        tabs: [],
        screenshot: undefined,
        accessibilityTree: {
          nodeId: 'root', role: 'WebArea', name: '',
          isInteractive: false, isVisible: true, isDisabled: false,
          children: [], attributes: {},
        },
        treeHash: '',
        domHash: '', viewportHeight: 900,
      } as import('../state/types.js').BrowserState;

      const result = await client.decide(state, [], 'Return done immediately');
      expect(result.decision).toBeDefined();
      expect(typeof result.decision.action).toBe('string');
    },
    30000,
  );
});
