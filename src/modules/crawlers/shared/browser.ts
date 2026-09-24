import type { Browser } from 'playwright';
import { CrawlerError } from '../../../shared/errors/app-error.js';

export interface RenderOptions {
  userAgent: string;
  timeoutMs: number;
  /** Seletor CSS que indica que o conteúdo dinâmico foi carregado. */
  waitForSelector: string;
}

/**
 * Browser Playwright compartilhado e iniciado sob demanda.
 * Usado apenas quando o conteúdo depende de JavaScript; um único browser é reutilizado
 * e cada renderização usa um contexto isolado (sem cookies persistidos).
 */
export class BrowserPool {
  private browser: Promise<Browser> | null = null;

  async renderHtml(url: string, options: RenderOptions): Promise<string> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({ userAgent: options.userAgent, locale: 'pt-BR' });
    try {
      const page = await context.newPage();
      // Imagens, fontes e mídia não são necessárias para extrair links.
      await page.route('**/*', (route) =>
        ['image', 'font', 'media'].includes(route.request().resourceType())
          ? route.abort()
          : route.continue(),
      );
      await page.goto(url, { timeout: options.timeoutMs, waitUntil: 'domcontentloaded' });
      await page
        .waitForSelector(options.waitForSelector, { timeout: options.timeoutMs })
        .catch(() => undefined);
      return await page.content();
    } catch (error) {
      throw new CrawlerError(`Failed to render ${url}: ${(error as Error).message}`);
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    if (!this.browser) return;
    const browser = await this.browser.catch(() => null);
    this.browser = null;
    await browser?.close();
  }

  private getBrowser(): Promise<Browser> {
    this.browser ??= import('playwright')
      .then(({ chromium }) => chromium.launch({ headless: true }))
      .catch((error: Error) => {
        this.browser = null;
        throw new CrawlerError(
          `Playwright browser unavailable (run "npx playwright install chromium"): ${error.message}`,
          false,
        );
      });
    return this.browser;
  }
}
