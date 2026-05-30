import express from 'express';
import { createLogger } from '../runtime/logger.js';
import { buildAgentConfig } from '../runtime/config.js';
import { AgentOrchestrator } from '../agent/index.js';
import { randomUUID } from 'node:crypto';

const log = createLogger('api');

// ─── OpenAI-compatible API server ─────────────────────────────────────────────

export async function startAPIServer(port: number): Promise<void> {
  const app = express();
  app.use(express.json());

  // POST /v1/chat/completions — treat "messages" last user message as the task
  app.post('/v1/chat/completions', async (req, res) => {
    try {
      const body = req.body as {
        messages: Array<{ role: string; content: string }>;
        model?: string;
        max_steps?: number;
        deterministic?: boolean;
      };

      const lastUserMessage = [...body.messages].reverse().find((m) => m.role === 'user');
      if (!lastUserMessage) {
        res.status(400).json({ error: 'No user message found' });
        return;
      }

      const config = buildAgentConfig({
        task: lastUserMessage.content,
        sessionId: randomUUID(),
        deterministicMode: body.deterministic,
        maxSteps: body.max_steps,
        model: body.model,
      });

      const orchestrator = new AgentOrchestrator(config);
      const result = await orchestrator.run();

      // Return OpenAI-compatible response
      res.json({
        id: `chatcmpl-${randomUUID()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: config.model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: result.success
                ? `Task completed: ${result.summary}`
                : `Task failed: ${result.failureReason}`,
            },
            finish_reason: result.success ? 'stop' : 'error',
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        extensions: { session_id: result.sessionId, steps_run: result.stepsRun },
      });
    } catch (err) {
      log.error({ err }, 'API request failed');
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /v1/sessions
  app.get('/v1/sessions', async (req, res) => {
    const { SessionManager } = await import('../runtime/session.js');
    const sessionsDir = (req.query['sessions_dir'] as string | undefined) ?? './sessions';
    const mgr = new SessionManager(sessionsDir);
    res.json(mgr.list());
  });

  // GET /health
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '0.1.0' });
  });

  app.listen(port, () => {
    log.info({ port }, 'OpenAI-compatible API server started');
    console.log(`Browser agent API running at http://localhost:${port}`);
  });
}
