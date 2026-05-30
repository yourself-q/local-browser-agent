import type { Browser, BrowserContext } from 'playwright';
import { connectToChrome, type CDPConfig } from './cdp.js';
import { PageWrapper } from './page.js';
import { createLogger } from '../runtime/logger.js';

export { PageWrapper } from './page.js';
export { TabManager } from './tabs.js';
export { connectToChrome } from './cdp.js';

const log = createLogger('browser');

// ─── Browser manager ──────────────────────────────────────────────────────────

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pageWrapper: PageWrapper | null = null;

  async connect(config: CDPConfig): Promise<PageWrapper> {
    const conn = await connectToChrome(config);
    this.browser = conn.browser;
    this.context = conn.context;
    this.pageWrapper = new PageWrapper(conn.context);

    // Handle disconnection
    this.browser.on('disconnected', () => {
      log.warn('Browser disconnected');
    });

    return this.pageWrapper;
  }

  getPage(): PageWrapper {
    if (!this.pageWrapper) throw new Error('Browser not connected. Call connect() first.');
    return this.pageWrapper;
  }

  async disconnect(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.context = null;
      this.pageWrapper = null;
      log.info('Browser disconnected');
    }
  }

  isConnected(): boolean {
    return this.browser?.isConnected() === true;
  }
}
