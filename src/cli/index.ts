#!/usr/bin/env node
import { program } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, basename } from 'node:path';
import type { ReferenceFile } from '../agent/types.js';
import { setLogLevel, setPretty } from '../runtime/logger.js';

// ─── CLI entry point ──────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

// Try to read package version
let version = '0.1.0';
try {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, '../../package.json'), 'utf8'),
  ) as { version: string };
  version = pkg.version;
} catch {
  // Ignore
}

program
  .name('browser-agent')
  .description('Local-first browser agent runtime with CDP attachment')
  .version(version)
  .option('--log-level <level>', 'Log level (trace|debug|info|warn|error)', 'info')
  .option('--no-pretty', 'Disable pretty log formatting')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts() as { logLevel: string; pretty: boolean };
    setLogLevel(opts.logLevel);
    setPretty(opts.pretty);
  });

// ── Commands ──────────────────────────────────────────────────────────────────

program
  .command('run')
  .description('Run an agent task')
  .requiredOption('-t, --task <task>', 'Task description')
  .option('-s, --session <id>', 'Session ID (auto-generated if omitted)')
  .option('--chrome-port <port>', 'Chrome remote debugging port', '9222')
  .option('--model <model>', 'LM Studio model name')
  .option('--max-steps <n>', 'Maximum agent steps', '50')
  .option('--steps <n>', 'Maximum agent steps (alias for --max-steps)')
  .option('--max-context-turns <n>', 'How many past turns to keep in LLM context (default 20)')
  .option('--approval', 'Enable human approval mode')
  .option('--deterministic', 'Enable deterministic execution mode')
  .option('--sessions-dir <dir>', 'Session storage directory', './sessions')
  .option('--data <files...>', 'Reference files (images or text) to pass to the agent')
  .action(async (opts: {
    task: string;
    session?: string;
    chromePort: string;
    model?: string;
    maxSteps: string;
    steps?: string;
    maxContextTurns?: string;
    approval?: boolean;
    deterministic?: boolean;
    sessionsDir: string;
    data?: string[];
  }) => {
    const { AgentOrchestrator } = await import('../agent/index.js');
    const { buildAgentConfig, getEnv } = await import('../runtime/config.js');
    const { randomUUID } = await import('node:crypto');

    const env = getEnv();

    // Load reference files
    const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
    const MIME: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
    };

    const referenceFiles: ReferenceFile[] = (opts.data ?? []).map((filePath) => {
      const ext = extname(filePath).toLowerCase();
      const name = basename(filePath);
      if (IMAGE_EXTS.has(ext)) {
        const buf = readFileSync(filePath);
        return { name, type: 'image' as const, content: buf.toString('base64'), mimeType: MIME[ext] ?? 'image/png' };
      } else {
        const text = readFileSync(filePath, 'utf8');
        return { name, type: 'text' as const, content: text };
      }
    });

    const config = buildAgentConfig({
      task: opts.task,
      sessionId: opts.session ?? randomUUID(),
      humanApprovalMode: opts.approval ?? false,
      deterministicMode: opts.deterministic ?? false,
      maxSteps: parseInt(opts.steps ?? opts.maxSteps, 10),
      maxContextTurns: opts.maxContextTurns ? parseInt(opts.maxContextTurns, 10) : undefined,
      model: opts.model,
      chromePort: parseInt(opts.chromePort, 10),
      referenceFiles: referenceFiles.length > 0 ? referenceFiles : undefined,
    });

    const orchestrator = new AgentOrchestrator(config);
    const result = await orchestrator.run();

    if (result.success) {
      console.log(`\n✓ Task complete in ${result.stepsRun} steps (${result.durationMs}ms)`);
      console.log(`  Session: ${result.sessionId}`);
      console.log(`  Summary: ${result.summary}`);
    } else {
      console.error(`\n✗ Task failed: ${result.failureReason}`);
      console.error(`  Session: ${result.sessionId}`);
      process.exitCode = 1;
    }
  });

program
  .command('replay')
  .description('Replay a session event log')
  .requiredOption('-s, --session <id>', 'Session ID')
  .option('--from-step <n>', 'Start from step N', '0')
  .option('--sessions-dir <dir>', 'Session storage directory', './sessions')
  .action(async (opts: { session: string; fromStep: string; sessionsDir: string }) => {
    const { ReplayEngine } = await import('../events/replay.js');
    const { join } = await import('node:path');

    const eventsPath = join(opts.sessionsDir, opts.session, 'events.jsonl');
    const engine = new ReplayEngine(eventsPath);
    engine.inspect({ fromStep: parseInt(opts.fromStep, 10) });
  });

program
  .command('inspect')
  .description('Inspect a session (metadata + event summary)')
  .requiredOption('-s, --session <id>', 'Session ID')
  .option('--sessions-dir <dir>', 'Session storage directory', './sessions')
  .option('--format <fmt>', 'Output format (pretty|json)', 'pretty')
  .action(async (opts: { session: string; sessionsDir: string; format: string }) => {
    const { join } = await import('node:path');
    const { readFileSync, existsSync } = await import('node:fs');
    const { ReplayEngine } = await import('../events/replay.js');

    const metaPath = join(opts.sessionsDir, opts.session, 'meta.json');
    if (!existsSync(metaPath)) {
      console.error(`Session not found: ${opts.session}`);
      process.exitCode = 1;
      return;
    }

    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));

    if (opts.format === 'json') {
      console.log(JSON.stringify(meta, null, 2));
    } else {
      console.log(`Session: ${meta.sessionId}`);
      console.log(`Task:    ${meta.task}`);
      console.log(`Status:  ${meta.status}`);
      console.log(`Steps:   ${meta.stepsRun}`);
      console.log(`Started: ${new Date(meta.startedAt).toISOString()}`);
      if (meta.endedAt) console.log(`Ended:   ${new Date(meta.endedAt).toISOString()}`);
    }

    const engine = new ReplayEngine(join(opts.sessionsDir, opts.session, 'events.jsonl'));
    engine.inspect();
  });

program
  .command('list')
  .description('List all sessions')
  .option('--sessions-dir <dir>', 'Session storage directory', './sessions')
  .action(async (opts: { sessionsDir: string }) => {
    const { SessionManager } = await import('../runtime/session.js');
    const mgr = new SessionManager(opts.sessionsDir);
    const sessions = mgr.list();

    if (sessions.length === 0) {
      console.log('No sessions found.');
      return;
    }

    for (const s of sessions.sort((a, b) => b.startedAt - a.startedAt)) {
      const started = new Date(s.startedAt).toISOString();
      const status = s.status.padEnd(10);
      console.log(`${status} ${s.sessionId.slice(0, 8)}  ${started}  "${s.task.slice(0, 60)}"`);
    }
  });

program
  .command('diagnose')
  .description('Diagnose browser connection quality, a11y tree, grounding confidence')
  .option('--port <port>', 'Chrome debugging port', '9222')
  .option('--url <url>', 'Navigate to this URL before diagnosing')
  .option('--show-tree', 'Print the full accessibility tree')
  .option('--show-dom', 'Print DOM element index')
  .option('--depth <n>', 'Max tree depth to print', '3')
  .action(async (opts: {
    port: string;
    url?: string;
    showTree?: boolean;
    showDom?: boolean;
    depth: string;
  }) => {
    const { diagnose } = await import('./commands/diagnose.js');
    await diagnose({
      port: parseInt(opts.port, 10),
      url: opts.url,
      showTree: opts.showTree,
      showDom: opts.showDom,
      depth: parseInt(opts.depth, 10),
    });
  });

program
  .command('mcp')
  .description('Start the MCP server')
  .option('--port <port>', 'MCP server port', '3000')
  .action(async (opts: { port: string }) => {
    const { startMCPServer } = await import('../mcp/index.js');
    await startMCPServer(parseInt(opts.port, 10));
  });

program
  .command('serve')
  .description('Start the OpenAI-compatible API server')
  .option('--port <port>', 'API server port', '8080')
  .action(async (opts: { port: string }) => {
    const { startAPIServer } = await import('../api/index.js');
    await startAPIServer(parseInt(opts.port, 10));
  });

program.parse();
