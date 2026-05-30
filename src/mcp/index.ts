import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createLogger } from '../runtime/logger.js';
import { buildAgentConfig } from '../runtime/config.js';
import { AgentOrchestrator } from '../agent/index.js';
import { CustomToolSchema } from '../tools/custom.js';
import { randomUUID } from 'node:crypto';

const log = createLogger('mcp');

// ─── MCP server ───────────────────────────────────────────────────────────────

export async function startMCPServer(_port: number): Promise<void> {
  const server = new Server(
    { name: 'browser-agent', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // ── Tool: browser_run_task ─────────────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'browser_run_task',
        description: 'Run an autonomous browser agent task using the connected Chrome session',
        inputSchema: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'The task to complete' },
            maxSteps: { type: 'number', description: 'Maximum steps (default 50)' },
            deterministicMode: { type: 'boolean', description: 'Enable deterministic execution' },
            chromePort: { type: 'number', description: 'Chrome debugging port (default 9222)' },
            customTools: {
              type: 'array',
              description: 'Optional custom actions to inject into the agent',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Action name (lowercase, e.g. fill_field)' },
                  description: { type: 'string', description: 'One-line description shown to the LLM' },
                  jsTemplate: {
                    type: 'string',
                    description: 'JavaScript executed in page context. Use ${value} for the LLM-supplied value.',
                  },
                },
                required: ['name', 'description', 'jsTemplate'],
              },
            },
          },
          required: ['task'],
        },
      },
      {
        name: 'browser_get_state',
        description: 'Capture the current browser state (accessibility tree + URL)',
        inputSchema: {
          type: 'object',
          properties: {
            chromePort: { type: 'number', description: 'Chrome debugging port (default 9222)' },
            includeScreenshot: { type: 'boolean', description: 'Include base64 screenshot' },
          },
        },
      },
      {
        name: 'browser_list_sessions',
        description: 'List all agent sessions',
        inputSchema: {
          type: 'object',
          properties: {
            sessionsDir: { type: 'string' },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'browser_run_task': {
          const input = z
            .object({
              task: z.string(),
              maxSteps: z.number().optional(),
              deterministicMode: z.boolean().optional(),
              chromePort: z.number().optional(),
              customTools: z.array(CustomToolSchema).optional(),
            })
            .parse(args);

          const config = buildAgentConfig({
            task: input.task,
            sessionId: randomUUID(),
            deterministicMode: input.deterministicMode,
            maxSteps: input.maxSteps,
            chromePort: input.chromePort,
            customTools: input.customTools,
          });

          const orchestrator = new AgentOrchestrator(config);
          const result = await orchestrator.run();

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }

        case 'browser_get_state': {
          const { BrowserManager } = await import('../browser/index.js');
          const { StateCapturer } = await import('../state/index.js');

          const input = z
            .object({ chromePort: z.number().optional(), includeScreenshot: z.boolean().optional() })
            .parse(args);

          const mgr = new BrowserManager();
          const pageWrapper = await mgr.connect({
            port: input.chromePort ?? 9222,
            host: 'localhost',
            timeoutMs: 10000,
            retries: 1,
          });

          const capturer = new StateCapturer('mcp', () => input.includeScreenshot ?? false);
          const state = await capturer.capture(pageWrapper.page, 0);
          await mgr.disconnect();

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    url: state.url,
                    title: state.title,
                    tabs: state.tabs,
                    interactiveElements: state.clickableElements.slice(0, 50),
                    screenshot: state.screenshot,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case 'browser_list_sessions': {
          const { SessionManager } = await import('../runtime/session.js');
          const input = z.object({ sessionsDir: z.string().optional() }).parse(args);
          const mgr = new SessionManager(input.sessionsDir ?? './sessions');
          const sessions = mgr.list();
          return {
            content: [{ type: 'text', text: JSON.stringify(sessions, null, 2) }],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (err) {
      log.error({ err, tool: name }, 'MCP tool error');
      return {
        content: [{ type: 'text', text: `Error: ${String(err)}` }],
        isError: true,
      };
    }
  });

  log.info('Starting MCP server (stdio transport)');
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
