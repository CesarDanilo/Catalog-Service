import type { Crawler } from './crawler.interface.js';

export class CrawlerRegistry {
  private readonly crawlers = new Map<string, Crawler>();

  register(crawler: Crawler): this {
    if (this.crawlers.has(crawler.source)) {
      throw new Error(`Crawler already registered for source "${crawler.source}"`);
    }
    this.crawlers.set(crawler.source, crawler);
    return this;
  }

  get(source: string): Crawler | undefined {
    return this.crawlers.get(source);
  }

  has(source: string): boolean {
    return this.crawlers.has(source);
  }

  list(): string[] {
    return [...this.crawlers.keys()];
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled([...this.crawlers.values()].map((crawler) => crawler.close?.()));
  }
}
