import type { BrowserContext, Page } from 'playwright';
import type { TabInfo } from '../state/types.js';
import { createLogger } from '../runtime/logger.js';

const log = createLogger('browser:tabs');

// ─── Tab manager ──────────────────────────────────────────────────────────────

export class TabManager {
  private activePage: Page;

  constructor(private readonly context: BrowserContext) {
    const pages = context.pages();
    if (pages.length === 0) throw new Error('No pages open in browser context');
    this.activePage = pages[pages.length - 1]!;

    // When a new page is created by the browser (target="_blank" link click,
    // window.open(), etc.), automatically follow it.  Without this, the new
    // tab/window appears in Chrome but our agent keeps operating on the old page,
    // making it look like a "different Chrome" opened.
    context.on('page', (newPage: Page) => {
      this.activePage = newPage;
      // Bring the new tab/window to front so the user sees what the agent is doing.
      newPage.bringToFront().catch(() => {});
      log.debug({ url: newPage.url() }, 'New page detected — following it');

      // Also listen for this page to close so we fall back gracefully.
      newPage.on('close', () => {
        // Revert to the last remaining page if the active one closes.
        const remaining = context.pages().filter((p) => p !== newPage);
        if (remaining.length > 0) {
          this.activePage = remaining[remaining.length - 1]!;
          this.activePage.bringToFront().catch(() => {});
          log.debug({ url: this.activePage.url() }, 'Active page closed — reverting to previous page');
        }
      });
    });
  }

  getActivePage(): Page {
    return this.activePage;
  }

  async getAllTabs(): Promise<TabInfo[]> {
    const pages = this.context.pages();
    return Promise.all(
      pages.map(async (page, index) => ({
        index,
        url: page.url(),
        title: await page.title().catch(() => ''),
        isActive: page === this.activePage,
      })),
    );
  }

  async switchToTab(index: number): Promise<Page> {
    const pages = this.context.pages();
    const page = pages[index];
    if (!page) {
      throw new Error(`Tab index ${index} out of range (${pages.length} tabs open)`);
    }
    this.activePage = page;
    await page.bringToFront();
    log.debug({ index, url: page.url() }, 'Switched to tab');
    return page;
  }

  async closeTab(index: number): Promise<void> {
    const pages = this.context.pages();
    const page = pages[index];
    if (!page) {
      throw new Error(`Tab index ${index} out of range`);
    }
    if (page === this.activePage) {
      // Switch to adjacent tab before closing
      const nextPage = pages[index + 1] ?? pages[index - 1];
      if (!nextPage) throw new Error('Cannot close the last tab');
      this.activePage = nextPage;
      await nextPage.bringToFront();
    }
    await page.close();
    log.debug({ index }, 'Closed tab');
  }

  async openTab(url?: string): Promise<Page> {
    const page = await this.context.newPage();
    if (url) await page.goto(url);
    this.activePage = page;
    log.debug({ url }, 'Opened new tab');
    return page;
  }
}
