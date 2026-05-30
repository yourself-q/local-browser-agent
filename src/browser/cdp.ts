import { chromium } from 'playwright';
import type { Browser, BrowserContext } from 'playwright';
import { createLogger } from '../runtime/logger.js';

const log = createLogger('browser:cdp');

// ─── Configuration ────────────────────────────────────────────────────────────

export interface CDPConfig {
  port: number;
  host: string;
  /** Connection timeout in ms */
  timeoutMs: number;
  /** Number of connection attempts */
  retries: number;
}

export const DEFAULT_CDP_CONFIG: CDPConfig = {
  port: 9222,
  host: 'localhost',
  timeoutMs: 15000,
  retries: 3,
};

// ─── Connection result ────────────────────────────────────────────────────────

export interface CDPConnection {
  browser: Browser;
  context: BrowserContext;
  wsEndpoint: string;
}

// ─── Connect to existing Chrome ───────────────────────────────────────────────

/**
 * Attaches to an existing Chrome instance via the CDP remote debugging port.
 *
 * The user must have started Chrome with:
 *   --remote-debugging-port=<port>
 *   --no-first-run
 *   --no-default-browser-check
 *
 * Returns the FIRST browser context, which preserves the existing session
 * (cookies, local storage, tabs) rather than spawning an isolated context.
 */
export async function connectToChrome(config: CDPConfig = DEFAULT_CDP_CONFIG): Promise<CDPConnection> {
  const endpoint = `http://${config.host}:${config.port}`;

  log.info({ endpoint }, 'Connecting to Chrome via CDP');

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= config.retries; attempt++) {
    try {
      const browser = await chromium.connectOverCDP(endpoint, {
        timeout: config.timeoutMs,
      });

      const contexts = browser.contexts();
      if (contexts.length === 0) {
        throw new Error(
          'Chrome has no browser contexts. Ensure a tab is open before connecting.',
        );
      }

      // Use the first context — this is the user's existing session
      const context = contexts[0]!;

      log.info({ endpoint, pages: context.pages().length }, 'Connected to Chrome');

      // Mask navigator.webdriver on every future page load.
      // Regular user Chrome does not set this flag, but CDP attachment can expose it
      // to bot-detection scripts. addInitScript() registers the patch for all new
      // documents navigated to in this session.
      try {
        await context.addInitScript(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });
      } catch {
        // Non-critical — some CDP versions may not support addInitScript on attached contexts
        log.debug('Could not register webdriver stealth patch (non-critical)');
      }

      return { browser, context, wsEndpoint: endpoint };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      log.warn(
        { attempt, maxRetries: config.retries, error: lastError.message },
        'CDP connection attempt failed',
      );

      if (attempt < config.retries) {
        // Exponential backoff: 1s, 2s, 4s
        const delayMs = 1000 * Math.pow(2, attempt - 1);
        await sleep(delayMs);
      }
    }
  }

  throw new Error(
    `Failed to connect to Chrome at ${endpoint} after ${config.retries} attempts.\n` +
      `Last error: ${lastError?.message ?? 'unknown'}\n\n` +
      `Start Chrome with:\n` +
      `  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome \\\n` +
      `    --remote-debugging-port=${config.port} \\\n` +
      `    --no-first-run \\\n` +
      `    --no-default-browser-check`,
  );
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
