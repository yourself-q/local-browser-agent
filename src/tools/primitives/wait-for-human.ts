import { createInterface } from 'node:readline';
import type { ToolExecutor, ToolContext, ExecutionResult } from '../types.js';
import { createLogger } from '../../runtime/logger.js';

const log = createLogger('tool:wait-for-human');

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ─── Wait for human tool ──────────────────────────────────────────────────────

/**
 * Pause agent execution and wait for the user to take a manual action
 * (e.g., solve a CAPTCHA, complete a 2FA prompt, log in manually).
 *
 * Prints a clear prompt to stderr and resumes when the user presses Enter.
 * In non-TTY environments (MCP server, piped input), returns an error immediately
 * since there is no interactive user to respond.
 */
export const WaitForHumanTool: ToolExecutor<{ reason: string; timeoutMs?: number }> = {
  name: 'wait_for_human',
  description: 'Pause and wait for the user to take a manual action (e.g. solve a CAPTCHA)',

  async execute(
    { reason, timeoutMs = DEFAULT_TIMEOUT_MS },
    _ctx: ToolContext,
  ): Promise<ExecutionResult> {
    const start = Date.now();
    log.warn({ reason }, 'Waiting for human intervention');

    // Non-interactive environment: stdin is not a TTY (MCP server piped to Claude Desktop,
    // CI, or any pipe mode). Cannot pause — surface a clear error so the session fails fast.
    if (!process.stdin.isTTY) {
      const msg =
        `Human intervention required but stdin is not interactive: ${reason}. ` +
        `Cannot pause for input in MCP/pipe mode.`;
      log.error(msg);
      return {
        success: false,
        action: 'wait_for_human',
        durationMs: Date.now() - start,
        error: msg,
      };
    }

    const sep = '─'.repeat(60);
    process.stderr.write(`\n${sep}\n`);
    process.stderr.write(`[HUMAN REQUIRED] ${reason}\n`);
    process.stderr.write(`Press Enter when ready to continue`);
    process.stderr.write(` (auto-fail in ${Math.round(timeoutMs / 1000)}s)...\n`);
    process.stderr.write(`${sep}\n\n`);

    try {
      await waitForEnterWithTimeout(timeoutMs);
      const elapsed = Date.now() - start;
      log.info({ elapsed }, 'Human confirmed — resuming');
      return {
        success: true,
        action: 'wait_for_human',
        durationMs: elapsed,
        output: 'Human confirmed — resuming task',
      };
    } catch {
      return {
        success: false,
        action: 'wait_for_human',
        durationMs: Date.now() - start,
        error: `Timed out waiting for human after ${Math.round(timeoutMs / 1000)}s`,
      };
    }
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function waitForEnterWithTimeout(timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const timer = setTimeout(() => {
      rl.close();
      reject(new Error('timeout'));
    }, timeoutMs);

    rl.once('line', () => {
      clearTimeout(timer);
      rl.close();
      resolve();
    });

    rl.once('close', () => {
      clearTimeout(timer);
      // stdin closed (e.g. EOF) — treat as confirmation
      resolve();
    });
  });
}
