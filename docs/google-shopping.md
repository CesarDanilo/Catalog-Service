# Google Shopping Provider

## Responsabilidade

Buscar produtos no Google Shopping **na hora** (sem persistir no banco) e devolvê-los no mesmo
formato comum de todas as fontes (`ScrapedProduct`). Fica exposto em
`GET /api/v1/providers/google-shopping/search`.

É só mais uma fonte registrada no `CrawlerRegistry`: nada fora de
`src/modules/crawlers/google-shopping/` conhece HTML, seletores ou a SerpApi.

## Arquitetura

```text
GET /api/v1/providers/:source/search            (live-search: validação, cache, paginação)
        │  registry.get(source).liveSearch()    — sem "if source === ..."
        ▼
GoogleShoppingProvider                           (fila, prazo total, retry, log)
        │
        ├── Fetcher (escolhido em GOOGLE_SHOPPING_FETCHER)
        │     ├── SerpApiFetcher   → JSON da API     (produção)
        │     └── BrowserFetcher   → HTML (Playwright) (só testes locais)
        ├── Parser (par do fetcher)
        │     ├── parseSerpApiResponse    JSON → RawGoogleShoppingProduct[]
        │     └── parseGoogleShoppingHtml HTML → RawGoogleShoppingProduct[]
        ├── Mapper    RawGoogleShoppingProduct → ScrapedProduct
        ├── Schemas   formato da resposta da SerpApi (Zod)
        └── Errors    Blocked / Timeout / Parse / Unavailable
```

| Arquivo                              | Responsabilidade                                              |
| ------------------------------------ | ------------------------------------------------------------- |
| `google-shopping.provider.ts`        | Orquestra; implementa `Crawler` (`liveSearch`, `search`)      |
| `google-shopping.browser-fetcher.ts` | Abre a página no Chromium, detecta bloqueio, devolve HTML     |
| `google-shopping.serpapi-fetcher.ts` | Chama a SerpApi, trata status HTTP, devolve JSON              |
| `google-shopping.html-parser.ts`     | HTML → produtos brutos (`extractTitle`, `extractPrice`...)    |
| `google-shopping.serpapi-parser.ts`  | JSON da SerpApi → produtos brutos                             |
| `google-shopping.selectors.ts`       | **Único** lugar com seletores CSS do Google                   |
| `google-shopping.values.ts`          | Texto → preço, moeda, nota, contagem, URL (comum aos parsers) |
| `google-shopping.mapper.ts`          | Produto bruto → `ScrapedProduct`                              |
| `google-shopping.url.ts`             | `buildRequest`, `buildSearchUrl`, `buildSerpApiUrl`           |
| `google-shopping.schemas.ts`         | Zod da resposta da SerpApi                                    |
| `google-shopping.errors.ts`          | Hierarquia de erros (sobre `CrawlerError`)                    |
| `google-shopping.config.ts`          | Configuração lida do env                                      |
| `index.ts`                           | Monta o provider com o par fetcher + parser configurado       |

Peças genéricas reaproveitáveis por outros providers: `shared/utils/concurrency-limiter.ts`,
`shared/utils/retry.ts`, `shared/utils/market.ts`, `normalizeSearchQuery` (`shared/utils/text.ts`),
`BrowserPool.withPage` e o módulo `live-search`.

## Configuração

Todas validadas em `src/config/env.ts`. Com `GOOGLE_SHOPPING_FETCHER=serpapi` sem chave, o
processo não sobe.

| Variável                                | Padrão          | Descrição                                          |
| --------------------------------------- | --------------- | -------------------------------------------------- |
| `GOOGLE_SHOPPING_FETCHER`               | `disabled`      | `disabled` \| `serpapi` \| `browser`               |
| `GOOGLE_SHOPPING_SERPAPI_KEY`           | —               | Chave da SerpApi (obrigatória com `serpapi`)       |
| `GOOGLE_SHOPPING_COUNTRY`               | `BR`            | Mercado padrão (ISO alpha-2)                       |
| `GOOGLE_SHOPPING_LANGUAGE`              | `pt-BR`         | Idioma padrão                                      |
| `GOOGLE_SHOPPING_DOMAIN`                | `google.com.br` | Domínio do Google (só `google.<tld>`)              |
| `GOOGLE_SHOPPING_CURRENCY`              | `BRL`           | Moeda quando o preço não traz símbolo reconhecível |
| `GOOGLE_SHOPPING_MAX_CONCURRENCY`       | `1`             | Buscas simultâneas (máx. 3)                        |
| `GOOGLE_SHOPPING_MAX_QUEUE`             | `5`             | Buscas esperando; acima disso → 503                |
| `GOOGLE_SHOPPING_REQUEST_DELAY_MS`      | `3000`          | Intervalo mínimo entre inícios de busca            |
| `GOOGLE_SHOPPING_TIMEOUT_MS`            | `25000`         | Prazo total (fila + tentativas + extração)         |
| `GOOGLE_SHOPPING_NAVIGATION_TIMEOUT_MS` | `15000`         | Navegação (browser) ou chamada HTTP (SerpApi)      |
| `GOOGLE_SHOPPING_SELECTOR_TIMEOUT_MS`   | `8000`          | Espera pelos cartões na página (browser)           |
| `GOOGLE_SHOPPING_MAX_ATTEMPTS`          | `2`             | Tentativas (só falhas passageiras)                 |
| `GOOGLE_SHOPPING_MAX_PRODUCTS`          | `60`            | Produtos guardados por busca                       |
| `GOOGLE_SHOPPING_CACHE_TTL`             | `3600`          | Cache do lote de uma busca (s)                     |

Trocar de mercado (BR → US/PT) é só configuração, ou `country`/`language` na requisição.

## Endpoint

```http
GET /api/v1/providers/google-shopping/search?q=camiseta%20preta&page=1&pageSize=20&country=BR&language=pt-BR
```

| Parâmetro  | Regra                                       |
| ---------- | ------------------------------------------- |
| `q`        | obrigatório, 1–120 caracteres (após `trim`) |
| `page`     | inteiro 1–5 (padrão 1)                      |
| `pageSize` | inteiro 1–40 (padrão 20)                    |
| `country`  | opcional, 2 letras                          |
| `language` | opcional, `pt`, `pt-BR`, `en`...            |

Qualquer outro parâmetro (ex.: `url=`) é ignorado: o navegador/API só recebem URLs montadas por
`google-shopping.url.ts`. Rate limit próprio: 30 buscas/min por IP.

Resposta:

```json
{
  "data": [
    {
      "position": 1,
      "externalId": "1001",
      "title": "Camiseta Preta Básica Masculina",
      "price": 49.9,
      "currency": "BRL",
      "imageUrl": "https://...",
      "productUrl": "https://...",
      "seller": "Loja X",
      "rating": 4.7,
      "reviewCount": 352,
      "source": "google-shopping"
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 40, "totalPages": 2 },
  "meta": { "source": "google-shopping", "country": "BR", "language": "pt-BR", "cached": false }
}
```

`imageUrl`, `seller`, `rating` e `reviewCount` só aparecem quando a fonte informa. Resultado sem
título, link ou preço fica de fora (é contado como `skipped` no log) — nada é inventado.

**Cache e paginação**: o lote inteiro de uma busca (termo normalizado + mercado) fica no Redis
por `GOOGLE_SHOPPING_CACHE_TTL`; a paginação anda sobre ele. "Camiseta Preta", "camiseta preta"
e " camiseta preta " são a mesma entrada. Buscas iguais ao mesmo tempo compartilham uma só ida
ao Google. Erros não são cacheados. Nada vai para o Postgres.

## Erros

| HTTP | `code`                        | Quando                                                          |
| ---- | ----------------------------- | --------------------------------------------------------------- |
| 400  | `VALIDATION_ERROR`            | Parâmetro inválido                                              |
| 404  | `PROVIDER_NOT_FOUND`          | Provider inexistente ou sem busca ao vivo                       |
| 429  | `RATE_LIMIT_EXCEEDED`         | Mais de 30 buscas/min do mesmo IP                               |
| 502  | `GOOGLE_SHOPPING_PARSE_ERROR` | Resposta sem a estrutura esperada (layout/API mudou)            |
| 503  | `GOOGLE_SHOPPING_BLOCKED`     | CAPTCHA / "tráfego incomum" / 429 do Google                     |
| 503  | `GOOGLE_SHOPPING_UNAVAILABLE` | Desligado, sem cota/chave inválida na SerpApi, fila cheia, rede |
| 504  | `GOOGLE_SHOPPING_TIMEOUT`     | Passou do prazo total                                           |

A mensagem ao cliente é sempre genérica; o motivo técnico (`reason`) só vai para o log.
Nunca saem HTML, seletores, stack trace, cookies, headers ou a chave da API.

**Retry**: só falhas passageiras (timeout, rede, 5xx), até `GOOGLE_SHOPPING_MAX_ATTEMPTS`, com
backoff exponencial (1s, 2s...) e dentro do prazo total. Bloqueio, erro de parse, chave inválida
e cota esgotada **nunca** são repetidos.

## Sem contornar proteções

O fetcher de navegador usa o Chromium do Playwright sem nenhum disfarce: sem stealth, sem
resolver CAPTCHA, sem trocar fingerprint, sem proxies, User-Agent identificável
(`CRAWLER_USER_AGENT`). Se o Google redirecionar para `/sorry/` (CAPTCHA), responder 429 ou
mostrar a página de "tráfego incomum", a busca para na hora com `GOOGLE_SHOPPING_BLOCKED`.

Consultas automatizadas à Pesquisa do Google sem permissão violam os termos dele. Por isso o
modo `browser` existe só para desenvolvimento/testes, e **em produção o caminho é a SerpApi**
(API paga que assume esse acesso).

## Logs

Uma linha por busca (logger `crawlers`, Pino):

```json
{
  "provider": "google-shopping",
  "fetcher": "browser",
  "query": "camiseta preta",
  "country": "BR",
  "language": "pt-BR",
  "status": "blocked",
  "durationMs": 1846,
  "errorCode": "GOOGLE_SHOPPING_BLOCKED",
  "reason": "redirected to /sorry/ (CAPTCHA)",
  "msg": "google shopping search failed"
}
```

Sucesso traz `resultCount`, `skipped` e `timings` (`browserMs`, `navigationMs`, `extractionMs`
ou `requestMs`; `parseMs`, `normalizeMs`, `attempt`). A busca vai normalizada e truncada em 100
caracteres; HTML, cookies e headers nunca são logados.

O catalog-service ainda não tem Sentry/métricas (ficou para uma etapa separada). Contadores como
`google_shopping_requests_total` / `_blocked_total` podem ser tirados destes logs (campos
`status` e `errorCode`) até lá.

## Testes

```bash
npm run test:unit                       # URL, valores, parsers, mapper, erros, schema, fila, retry, provider
npm run test:integration                # inclui o endpoint de ponta a ponta e a carga local
npm run test:google-shopping            # REAL e opcional (nunca no npm test / CI)
npm run test:google-shopping -- --fetcher=browser "tenis masculino" "vestido feminino"
npm run test:google-shopping -- --fetcher=serpapi "camiseta preta"
```

- Fixtures em `tests/fixtures/google-shopping/` (ver o README de lá): `blocked.html` é real e
  sanitizada; as páginas de resultado são **sintéticas** (ver Limitações).
- `tests/integration/google-shopping.api.test.ts`: HTTP → service → provider → scraper falso →
  parser, sem internet/Redis/Postgres.
- `tests/integration/google-shopping.load.test.ts`: 10/50/100 requisições simultâneas contra o
  pipeline mockado (concorrência nunca passa do limite, nenhuma "página" fica aberta, sem 500,
  excesso vira 503/429).
- O teste real imprime quantidade, cobertura de campos, 3 exemplos e duração; sai com 0 (PASS),
  1 (FAIL) ou 2 (BLOCKED) e para no primeiro bloqueio.

## Limitações

- **O Google bloqueia a automação.** Em 2026-09-29 a primeira busca automatizada já foi para o
  CAPTCHA (rede residencial, Chromium headless). De servidor (AWS) é ainda mais provável. O
  modo `browser` serve para testes, não para produção.
- **Seletores de HTML não validados contra uma página real** (por causa do bloqueio). Estão
  isolados em `google-shopping.selectors.ts`, com alternativas por campo. Quando conseguir uma
  página real (ex.: salva manualmente no navegador), troque `search-success.html` por ela
  (sanitizada) e ajuste os seletores até os testes passarem — o resto do sistema não muda.
- **SerpApi**: devolve um lote fixo (~40 itens) por busca, sem paginação real; por isso a
  paginação é sobre o lote em cache. Cada busca nova custa uma consulta do plano.
- A estrutura do Google Shopping muda com frequência. É exatamente por isso que HTML/JSON ficam
  presos nos parsers + seletores: uma mudança de layout mexe só neles.
- Launch do Chromium dentro do container foi de 2 a 27 s nesta máquina (sob carga); um launch
  frio pode estourar o prazo total de 25 s no modo `browser`.
