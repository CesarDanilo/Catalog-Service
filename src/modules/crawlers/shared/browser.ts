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

  /**
   * Renderiza a página e devolve o JSON de uma resposta que a PRÓPRIA página busca ao carregar
   * (ex.: a API de busca que o site usa pra montar a vitrine). Nenhuma requisição extra: é o mesmo
   * tráfego de uma visita normal — só lemos o que o navegador já recebeu, em vez de esperar a
   * vitrine desenhar (preço, por exemplo, só aparece quando o cartão entra na tela). `null` se a
   * resposta não vier no prazo.
   */
  async captureJson(
    url: string,
    options: Omit<RenderOptions, 'waitForSelector'> & { responseUrl: RegExp },
  ): Promise<unknown> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({ userAgent: options.userAgent, locale: 'pt-BR' });
    try {
      const page = await context.newPage();
      await page.route('**/*', (route) =>
        ['image', 'font', 'media', 'stylesheet'].includes(route.request().resourceType())
          ? route.abort()
          : route.continue(),
      );
      const captured = page
        .waitForResponse(
          (response) => options.responseUrl.test(response.url()) && response.status() === 200,
          { timeout: options.timeoutMs },
        )
        .then((response) => response.json() as Promise<unknown>)
        .catch(() => null);
      await page.goto(url, { timeout: options.timeoutMs, waitUntil: 'domcontentloaded' });
      return await captured;
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
