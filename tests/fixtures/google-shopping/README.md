# Fixtures do Google Shopping

- `blocked.html` — página REAL de bloqueio do Google (`/sorry/`, reCAPTCHA), capturada em
  2026-09-29 na primeira busca automatizada ("camiseta preta"). Sanitizada: IP, tokens, sitekey
  e parâmetros de sessão removidos.
- `search-*.html` e `missing-*.html` — SINTÉTICAS. Como o Google bloqueou a automação já na
  primeira busca, não foi possível capturar uma página real de resultados. Elas seguem os
  seletores de `src/modules/crawlers/google-shopping/google-shopping.selectors.ts`
  (`[data-docid]` e o layout antigo `.sh-dgr__grid-result`). Quando uma página real for obtida
  (ex.: salva manualmente no navegador), substitua `search-success.html` por ela, sanitizada, e
  ajuste os seletores até os testes passarem.
- `serpapi-*.json` — SINTÉTICAS, no formato documentado da SerpApi (engine `google_shopping`),
  com os mesmos campos que o backend já consome em produção.
