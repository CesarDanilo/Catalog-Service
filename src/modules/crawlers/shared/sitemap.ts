import * as cheerio from 'cheerio';

export interface SitemapDocument {
  /** Sitemaps filhos (quando o documento é um <sitemapindex>). */
  sitemaps: string[];
  /** URLs de páginas (quando o documento é um <urlset>). */
  urls: string[];
}

export function parseSitemap(xml: string): SitemapDocument {
  const $ = cheerio.load(xml, { xml: true });
  const locs = (selector: string) =>
    $(selector)
      .map((_, element) => $(element).text().trim())
      .get()
      .filter(Boolean);
  return { sitemaps: locs('sitemapindex > sitemap > loc'), urls: locs('urlset > url > loc') };
}
