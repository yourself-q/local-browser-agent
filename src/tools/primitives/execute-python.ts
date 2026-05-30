import { spawn } from 'node:child_process';
import type { ToolExecutor, ToolContext, ExecutionResult } from '../types.js';
import { createLogger } from '../../runtime/logger.js';

const log = createLogger('tool:python');

const TIMEOUT_MS = 30_000;   // 30 seconds
const MAX_OUTPUT = 4_000;    // chars — prevent flooding context window

// ─── Python execution tool ────────────────────────────────────────────────────

/**
 * Execute a Python 3 snippet and return its stdout/stderr.
 *
 * Intended for calculations, data processing, and transformations that
 * are easier to express in code than with browser actions.
 *
 * Security note: this runs arbitrary code in a subprocess with full user
 * permissions. Only suitable for local/trusted use cases.
 */
export const ExecutePythonTool: ToolExecutor<{ code: string }> = {
  name: 'execute_python',
  description: 'Run a Python 3 code snippet and return stdout/stderr output',

  async execute({ code }, _ctx: ToolContext): Promise<ExecutionResult> {
    const start = Date.now();
    log.debug({ codeLength: code.length }, 'Executing Python snippet');

    try {
      const output = await runPython(code);
      return {
        success: true,
        action: 'execute_python',
        durationMs: Date.now() - start,
        output: output.slice(0, MAX_OUTPUT),
      };
    } catch (err) {
      return {
        success: false,
        action: 'execute_python',
        durationMs: Date.now() - start,
        error: String(err).slice(0, MAX_OUTPUT),
      };
    }
  },
};

// ─── Runner ───────────────────────────────────────────────────────────────────

function runPython(code: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-c', code], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: TIMEOUT_MS,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Python execution timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    proc.on('close', (code) => {
      clearTimeout(timer);
      const combined = [stdout, stderr].filter(Boolean).join('\n--- stderr ---\n');
      if (code === 0) {
        resolve(combined || '(no output)');
      } else {
        reject(new Error(combined || `Process exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn python3: ${err.message}. Is Python 3 installed?`));
    });
  });
}
