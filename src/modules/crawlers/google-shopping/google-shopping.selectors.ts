/**
 * Seletores da página de resultados do Google Shopping — o ÚNICO lugar que conhece o HTML dele.
 * Quando o Google mudar o layout, só este arquivo (e as fixtures) precisam mudar.
 *
 * Não validado contra uma página real: o Google respondeu CAPTCHA já na primeira busca
 * automatizada (2026-09-29). As listas vão do mais semântico/estável ao mais específico, e cada
 * campo tem várias alternativas — o parser usa a primeira que achar.
 */
export const SELECTORS = {
  /** Cartões de produto (o primeiro seletor que achar algum ganha). */
  cards: ['[data-docid]', '.sh-dgr__grid-result', '.sh-dlr__list-result'],
  /** Presença de qualquer um indica uma página de resultados (mesmo sem produtos). */
  resultsContainer: ['#search', '#rso', '#center_col', '[role="main"]'],
  /** Aviso de "nenhum resultado". */
  noResults: ['#topstuff .card-section', '[data-no-results]'],
  /** Página de bloqueio (CAPTCHA / "tráfego incomum"). */
  blocked: ['#captcha-form', 'form[action*="sorry"]', '.g-recaptcha', '#recaptcha'],
  title: ['h3', '[role="heading"]', '.tAxDx'],
  seller: ['[data-merchant-name]', '.aULzUe', '.IuHnof'],
  rating: ['[aria-label*=" de 5"]', '[aria-label*="out of 5"]', '.Rsc7Yb'],
  reviewCount: ['[aria-label*="avalia"]', '[aria-label*="review"]', '.QIrs8'],
} as const;

/** Textos que só aparecem na página de bloqueio do Google. */
export const BLOCKED_TEXT = [/tr[aá]fego incomum/i, /unusual traffic/i];

/** A página já tem produtos, resultado vazio ou o bloqueio — o scraper pode ler o HTML. */
export const PAGE_READY_SELECTOR = [
  ...SELECTORS.cards,
  ...SELECTORS.noResults,
  ...SELECTORS.blocked,
].join(', ');
