import type { Browser, Page } from 'playwright';
import { CrawlerError } from '../../../shared/errors/app-error.js';

export interface RenderOptions {
  userAgent: string;
  timeoutMs: number;
  /** Seletor CSS que indica que o conteúdo dinâmico foi carregado. */
  waitForSelector: string;
}

export interface PageOptions {
  userAgent: string;
  /** Padrão: pt-BR. */
  locale?: string;
  /** Tipos de recurso que não são baixados (ex.: image, font, media). */
  blockResources?: readonly string[];
  /** Abortar fecha o contexto na hora — qualquer operação pendente na página rejeita. */
  signal?: AbortSignal;
}

/**
 * Browser Playwright compartilhado e iniciado sob demanda.
 * Usado apenas quando o conteúdo depende de JavaScript; um único browser é reutilizado
 * e cada renderização usa um contexto isolado (sem cookies persistidos).
 */
export class BrowserPool {
  private browser: Promise<Browser> | null = null;

  /**
   * Abre uma página num contexto novo e isolado, entrega pra `task` e fecha o contexto no fim
   * (sucesso, erro ou abort) — nenhuma página fica aberta.
   */
  async withPage<T>(options: PageOptions, task: (page: Page) => Promise<T>): Promise<T> {
    options.signal?.throwIfAborted();
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      userAgent: options.userAgent,
      locale: options.locale ?? 'pt-BR',
    });
    const closeOnAbort = () => void context.close().catch(() => undefined);
    options.signal?.addEventListener('abort', closeOnAbort, { once: true });
    try {
      // Abortado enquanto o Chromium abria: não chega a abrir página.
      options.signal?.throwIfAborted();
      const page = await context.newPage();
      const blocked = options.blockResources ?? [];
      if (blocked.length > 0) {
        await page.route('**/*', (route) =>
          blocked.includes(route.request().resourceType()) ? route.abort() : route.continue(),
        );
      }
      return await task(page);
    } finally {
      options.signal?.removeEventListener('abort', closeOnAbort);
      await context.close().catch(() => undefined);
    }
  }

  async renderHtml(url: string, options: RenderOptions): Promise<string> {
    try {
      // Imagens, fontes e mídia não são necessárias para extrair links.
      return await this.withPage(
        { userAgent: options.userAgent, blockResources: ['image', 'font', 'media'] },
        async (page) => {
          await page.goto(url, { timeout: options.timeoutMs, waitUntil: 'domcontentloaded' });
          await page
            .waitForSelector(options.waitForSelector, { timeout: options.timeoutMs })
            .catch(() => undefined);
          return await page.content();
        },
      );
    } catch (error) {
      throw this.renderError(url, error);
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
    try {
      return await this.withPage(
        {
          userAgent: options.userAgent,
          blockResources: ['image', 'font', 'media', 'stylesheet'],
        },
        async (page) => {
          const captured = page
            .waitForResponse(
              (response) => options.responseUrl.test(response.url()) && response.status() === 200,
              { timeout: options.timeoutMs },
            )
            .then((response) => response.json() as Promise<unknown>)
            .catch(() => null);
          await page.goto(url, { timeout: options.timeoutMs, waitUntil: 'domcontentloaded' });
          return await captured;
        },
      );
    } catch (error) {
      throw this.renderError(url, error);
    }
  }

  async close(): Promise<void> {
    if (!this.browser) return;
    const browser = await this.browser.catch(() => null);
    this.browser = null;
    await browser?.close();
  }

  private renderError(url: string, error: unknown): CrawlerError {
    // Browser indisponível já vem como CrawlerError não-retentável.
    if (error instanceof CrawlerError) return error;
    return new CrawlerError(`Failed to render ${url}: ${(error as Error).message}`);
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
