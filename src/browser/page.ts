import type { Page, BrowserContext } from 'playwright';
import { TabManager } from './tabs.js';
import { createLogger } from '../runtime/logger.js';

const log = createLogger('browser:page');

// ─── Page wrapper ─────────────────────────────────────────────────────────────

/**
 * Thin wrapper around a Playwright Page that adds:
 * - network idle waiting
 * - DOM mutation observation
 * - tab awareness through TabManager
 */
export class PageWrapper {
  readonly tabs: TabManager;

  constructor(readonly context: BrowserContext) {
    this.tabs = new TabManager(context);
  }

  get page(): Page {
    return this.tabs.getActivePage();
  }

  /** Wait for network to go idle with a timeout */
  async waitForNetworkIdle(timeoutMs = 5000): Promise<void> {
    try {
      await this.page.waitForLoadState('networkidle', { timeout: timeoutMs });
    } catch {
      // Timeout is acceptable — page may have long-polling
      log.debug('Network idle timeout (acceptable)');
    }
  }

  /** Take a full-page screenshot, returns base64 PNG */
  async screenshot(): Promise<string> {
    const buffer = await this.page.screenshot({ type: 'png', fullPage: false });
    return buffer.toString('base64');
  }

  /** Wait for a DOM mutation to occur within timeoutMs */
  async waitForDOMMutation(timeoutMs = 3000): Promise<boolean> {
    try {
      await this.page.waitForFunction(
        () => {
          return new Promise<boolean>((resolve) => {
            const observer = new MutationObserver(() => {
              observer.disconnect();
              resolve(true);
            });
            observer.observe(document.body, {
              childList: true,
              subtree: true,
              attributes: true,
            });
            // Resolve false after timeoutMs if no mutations
            setTimeout(() => {
              observer.disconnect();
              resolve(false);
            }, 3000);
          });
        },
        { timeout: timeoutMs + 500 },
      );
      return true;
    } catch {
      return false;
    }
  }

  /** Scroll an element into view if needed */
  async scrollIntoView(selector: string): Promise<void> {
    await this.page.locator(selector).scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  }

  /** Get the currently focused element's accessible name */
  async getFocusedElementInfo(): Promise<{ role: string; name: string } | undefined> {
    try {
      return await this.page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return undefined;
        return {
          role: el.getAttribute('role') ?? el.tagName.toLowerCase(),
          name:
            el.getAttribute('aria-label') ??
            el.getAttribute('placeholder') ??
            (el as HTMLElement).innerText?.slice(0, 80) ??
            '',
        };
      });
    } catch {
      return undefined;
    }
  }
}
