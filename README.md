# catalog-service

Serviço de catálogo de produtos de moda para o **provador virtual**. Mantém um catálogo próprio
(PostgreSQL), alimentado de forma assíncrona por crawlers de lojas, e o expõe por uma API REST
com cache (Redis). O provador consulta apenas esta API — não conhece scrapers, filas ou HTML.

- [Visão geral](#visão-geral)
- [Arquitetura](#arquitetura)
- [Stack](#stack)
- [Estrutura](#estrutura)
- [Requisitos](#requisitos)
- [Instalação e execução local](#instalação-e-execução-local)
- [Environment variables](#environment-variables)
- [Docker](#docker)
- [Prisma e banco de dados](#prisma-e-banco-de-dados)
- [Redis e cache](#redis-e-cache)
- [BullMQ e workers](#bullmq-e-workers)
- [Crawlers](#crawlers)
- [API](#api)
- [Swagger](#swagger)
- [Integração com o provador](#integração-com-o-provador)
- [Testes](#testes)
- [Desenvolvimento](#desenvolvimento)
- [Produção](#produção)
- [Adicionando uma nova loja](#adicionando-uma-nova-loja)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)

---

## Visão geral

| Responsabilidade                | Como                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------- |
| Pesquisar/listar produtos       | `GET /api/v1/products` e `/products/search` sobre o catálogo persistido      |
| Armazenar e normalizar          | Crawler → Parser → Mapper → **Normalizer** (regras determinísticas) → upsert |
| Evitar duplicação               | Identidade do produto = `(sourceId, externalId)` (unique + upsert)           |
| Sincronizar fontes              | `POST /api/v1/sources/:id/sync` → fila `crawler` → worker                    |
| Atualizar preço/disponibilidade | Cada crawl atualiza preço, preço original, disponibilidade e `lastScrapedAt` |
| Agendamento                     | Scheduler do worker (BullMQ job schedulers) conforme `Source.crawlInterval`  |
| Novas lojas                     | Implementar a interface `Crawler` e registrar — sem tocar no núcleo          |

A busca do usuário **nunca** dispara scraping síncrono: ela lê o PostgreSQL (com cache Redis).

## Arquitetura

```text
Provador (frontend/backend)
   │  HTTP REST  /api/v1
   ▼
Catalog API (Fastify) ──────────────► Redis (cache de busca/produto, rate limit)
   │  Route → Controller → Service → Repository → Prisma
   ▼
PostgreSQL  ◄───────────────────────────────┐  (fonte de verdade)
   ▲                                        │
   │ POST /sources/:id/sync                 │ upsert (sourceId, externalId)
   ▼                                        │
BullMQ (fila "crawler", no Redis)           │
   │  crawl-source / sync-source            │
   ▼                                        │
Crawler Worker ── CrawlRunner ── Normalizer ┘
   │
   ▼
CrawlerRegistry → RennerCrawler | CACrawler | AmazonCrawler | ...
   │
   ▼
Lojas (HTTP + Cheerio; Playwright só quando o conteúdo depende de JS)
```

Decisões principais:

- **API e worker são processos separados** usando a mesma imagem Docker. A API só enfileira; o
  worker executa crawls. Ambos escalam horizontalmente (várias APIs atrás de um load balancer,
  vários workers consumindo a mesma fila).
- **PostgreSQL é a fonte de verdade.** Redis é usado para cache, fila, locks e rate limit.
- **O domínio não conhece BullMQ**: `SourceService` depende da interface `CrawlQueue`;
  `BullCrawlerQueue` é a implementação.
- **Validação com Zod nos controllers** (fonte única). Os JSON Schemas das rotas são gerados a
  partir dos mesmos schemas Zod, apenas para a documentação OpenAPI.

## Stack

Node.js 22 · TypeScript (strict) · Fastify 5 · PostgreSQL 17 + Prisma 6 · Redis 7 (ioredis) ·
BullMQ 5 · Cheerio · Playwright · Zod 4 · Vitest · ESLint 9 + Prettier · Swagger/OpenAPI ·
Docker/Compose · GitHub Actions.

## Estrutura

```text
src/
├── app.ts                  # cria o Fastify: plugins, Swagger, CORS, Helmet, rate limit, rotas, erros
├── server.ts               # entrypoint da API: conecta Postgres/Redis, inicia, graceful shutdown
├── worker.ts               # entrypoint do worker: fila crawler + scheduler + graceful shutdown
├── container.ts            # composition root (injeção de dependências manual)
├── config/env.ts           # variáveis de ambiente validadas com Zod
├── modules/
│   ├── products/           # routes, controller, service, repository, schema, types, search
│   ├── categories/         # árvore de categorias
│   ├── sources/            # lojas + sync
│   ├── crawl-jobs/         # histórico/status dos crawls + port CrawlQueue
│   ├── health/             # /health, /health/database, /health/redis
│   └── crawlers/
│       ├── crawler.interface.ts   # contrato Crawler
│       ├── crawler.types.ts       # ScrapedProduct, CrawlItem, CrawlOptions
│       ├── crawler.registry.ts    # CrawlerRegistry
│       ├── crawler.factory.ts     # registra as lojas (único ponto que conhece todas)
│       ├── crawl.runner.ts        # orquestra crawler → normalizer → upsert → métricas
│       ├── normalizer/            # regras determinísticas (gênero, cor, categoria, preço...)
│       ├── shared/                # HttpClient responsável, BrowserPool (Playwright), sitemap
│       ├── renner/                # renner.crawler / renner.parser / renner.mapper
│       ├── ca/                    # ca.crawler / ca.parser / ca.mapper
│       └── amazon/                # adapter preparado para fonte autorizada
├── infrastructure/
│   ├── database/prisma.ts
│   ├── redis/              # conexão, CacheService, LockService
│   └── queue/              # BullMQ: fila crawler + worker
├── jobs/scheduler.ts       # agendamento periódico por fonte
└── shared/                 # erros, error handler, helpers HTTP/OpenAPI, utils
prisma/                     # schema, migrations, seed
tests/                      # unit/, integration/, fixtures/ (HTML/JSON reais), helpers/
scripts/manual-crawl.ts     # teste manual de crawler contra a loja real
```

## Requisitos

- Node.js **22+** e npm
- Docker + Docker Compose (Postgres e Redis)
- Para a busca da Renner (Playwright): `npx playwright install chromium`
  (na imagem Docker isso já é feito)

## Instalação e execução local

```bash
npm install
cp .env.example .env

# Postgres (porta 5433 no host) e Redis (6379)
docker compose up -d postgres redis

npx prisma generate
npx prisma migrate dev
npx prisma db seed

# (opcional) browser para crawlers que dependem de JavaScript
npx playwright install chromium

npm run dev       # API em http://localhost:3333
npm run worker    # worker (outro terminal)
```

> O Postgres do Compose é publicado na porta **5433** do host para não conflitar com outro
> Postgres local na 5432. Dentro da rede do Compose ele continua em `postgres:5432`.

## Environment variables

Todas são validadas em `src/config/env.ts` (o processo não sobe com configuração inválida).
Variáveis do ambiente têm precedência sobre o arquivo `.env`.

| Variável                               | Padrão                        | Descrição                                                          |
| -------------------------------------- | ----------------------------- | ------------------------------------------------------------------ |
| `NODE_ENV`                             | `development`                 | `development` \| `test` \| `production`                            |
| `PORT` / `HOST`                        | `3333` / `0.0.0.0`            | Endereço da API                                                    |
| `LOG_LEVEL`                            | `info`                        | Nível do Pino                                                      |
| `CORS_ORIGIN`                          | `http://localhost:3000`       | Origens permitidas, separadas por vírgula. Não use `*` em produção |
| `BODY_LIMIT`                           | `1048576`                     | Tamanho máximo do corpo (bytes)                                    |
| `REQUEST_TIMEOUT`                      | `15000`                       | Timeout de requisições recebidas (ms)                              |
| `DATABASE_URL`                         | —                             | Conexão PostgreSQL                                                 |
| `REDIS_URL`                            | —                             | Conexão Redis                                                      |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW` | `100` / `1 minute`            | Rate limit por IP                                                  |
| `CACHE_TTL`                            | `300`                         | TTL do cache de busca (s)                                          |
| `CACHE_PRODUCT_TTL`                    | `600`                         | TTL do cache de produto/categorias (s)                             |
| `CRAWLER_TIMEOUT`                      | `30000`                       | Timeout por requisição do crawler (ms)                             |
| `CRAWLER_MAX_RETRIES`                  | `3`                           | Tentativas por requisição e por job da fila                        |
| `CRAWLER_REQUEST_DELAY`                | `1000`                        | Intervalo mínimo entre requisições à mesma loja (ms)               |
| `CRAWLER_CONCURRENCY`                  | `1`                           | Jobs simultâneos por worker                                        |
| `CRAWLER_USER_AGENT`                   | `CatalogServiceBot/0.1 (...)` | User-Agent identificável dos crawlers                              |
| `SCHEDULER_ENABLED`                    | `false`                       | Liga o agendamento periódico no worker                             |

Nunca versione `.env`, credenciais, tokens, cookies ou chaves de API (o `.gitignore` já exclui `.env`).

## Docker

A mesma imagem roda API e worker com comandos diferentes. O `docker-compose.yml` sobe
`api`, `worker`, `postgres` e `redis`; a API aplica migrations e seed ao iniciar.

```bash
docker compose up --build        # sobe tudo
docker compose ps                # status (api fica "healthy" via /health)
docker compose logs -f api
docker compose logs -f worker
docker compose down              # para (volumes preservados)
docker compose down -v           # para e apaga os dados
```

Em desenvolvimento, `src/` é montado como volume (hot reload com `tsx watch`).
O `Dockerfile` também tem o target `production` (build compilado, `npm prune`, usuário `node`):

```bash
docker build --target production -t catalog-service .
docker run --env-file .env -p 3333:3333 catalog-service                        # API
docker run --env-file .env catalog-service node dist/worker.js                 # worker
```

## Prisma e banco de dados

```bash
npm run db:generate   # prisma generate
npm run db:migrate    # prisma migrate dev (desenvolvimento)
npm run db:deploy     # prisma migrate deploy (produção/CI)
npm run db:seed       # fontes + árvore de categorias (idempotente)
npm run db:studio     # Prisma Studio
```

Tabelas:

| Tabela         | Conteúdo                                                                                                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Source`       | Lojas. `slug` liga a fonte ao crawler. `enabled`, `crawlInterval` (min), `maxPages`, `config` (JSON por loja), `lastSyncAt`                                                                                                  |
| `Category`     | Hierarquia via `parentId`. Filtrar uma categoria inclui as descendentes                                                                                                                                                      |
| `Product`      | Catálogo. **Unique `(sourceId, externalId)`**. `price`/`originalPrice` em `Decimal(12,2)`, `rawData` (JSONB, só auditoria), `searchText` (texto normalizado para busca), `imageUrl`/`imageCachedUrl`/`imageProcessingStatus` |
| `ProductImage` | Múltiplas imagens por produto (`position`), gravadas na mesma transação do produto                                                                                                                                           |
| `CrawlJob`     | Execuções: `PENDING → RUNNING → COMPLETED/FAILED`, contadores e `errorMessage`                                                                                                                                               |

Índices: `sourceId+externalId` (unique), `categoryId`, `brand`, `gender`, `color`, `price`,
`available`, `createdAt`, `updatedAt`, `lastScrapedAt`, e um índice **GIN trigram** (`pg_trgm`)
em `searchText` para a busca por substring. A árvore de categorias do seed é por tipo de peça
(Roupas → Camisas, Vestidos, Calças…); gênero é um campo do produto, assim "Calças" existe uma
vez e é filtrada com `gender=masculino|feminino`.

## Redis e cache

Toda interação com cache passa por `CacheService` (`src/infrastructure/redis/cache.service.ts`).

| Chave                           | TTL                          | Conteúdo                                                                                                                              |
| ------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `catalog:search:<hash>`         | `CACHE_TTL` (5 min)          | Resultado de listagem/busca. O hash vem dos **filtros já normalizados**, então `?color=Preta` e `?color=preto` compartilham a entrada |
| `catalog:product:<id>`          | `CACHE_PRODUCT_TTL` (10 min) | Detalhe do produto. **Invalidado** a cada upsert do produto                                                                           |
| `catalog:categories`            | `CACHE_PRODUCT_TTL`          | Árvore de categorias                                                                                                                  |
| `catalog:lock:crawl:<sourceId>` | 1 h                          | Lock: um crawl por fonte por vez                                                                                                      |
| `catalog:ratelimit:*`           | janela                       | Rate limit compartilhado entre instâncias da API                                                                                      |

Buscas não são invalidadas individualmente (expiram pelo TTL). Se o Redis cair, o cache é
degradado para "miss" e a API continua respondendo a partir do Postgres.

## BullMQ e workers

- Fila: **`crawler`**.
- Jobs: **`crawl-source`** (executa um `CrawlJob` criado pela API) e **`sync-source`**
  (disparado pelo scheduler; cria o `CrawlJob` e executa).
- Retry: `attempts = CRAWLER_MAX_RETRIES` (3) com backoff **exponencial** (30 s, 60 s, ...).
  Erros definitivos (fonte desabilitada, sem crawler, loja bloqueou com 401/403, integração
  ausente) viram `UnrecoverableError` e **não** são repetidos.
- O `jobId` do BullMQ é o id do `CrawlJob`, então o mesmo job não entra duas vezes na fila.
- Uma falha de scraper nunca derruba o worker; falhas de produtos individuais incrementam
  `productsFailed` e o crawl continua.

Fluxo do worker (`CrawlRunner`):

1. carrega o `CrawlJob` e a `Source`; aborta se a fonte está desabilitada ou sem crawler;
2. adquire o lock da fonte no Redis;
3. marca `RUNNING` e executa `crawler.crawl()` ou `crawler.search(query)`;
4. para cada item: **normaliza** → resolve categoria → **upsert** `(sourceId, externalId)` →
   invalida o cache do produto; atualiza o progresso a cada 25 itens;
5. marca `COMPLETED` (ou `FAILED` com `errorMessage` e estatísticas parciais), atualiza
   `Source.lastSyncAt`, registra duração e contadores nos logs.

**Scheduler** (`src/jobs/scheduler.ts`): com `SCHEDULER_ENABLED=true`, o worker cria um job
repetível por fonte habilitada com `crawlInterval` (ex.: `360` = a cada 6 h) e reaplica a
configuração a cada 5 minutos (mudanças via `PATCH /sources/:id` são refletidas).

## Crawlers

Fluxo: `Crawler (obtém) → Parser (interpreta HTML/JSON) → Mapper (ScrapedProduct) → Normalizer → Product`.

Os crawlers retornam `AsyncIterable<CrawlItem>`: cada item é um produto ou uma falha isolada,
e os produtos são persistidos conforme chegam (sem carregar o catálogo inteiro em memória).

### Status real das fontes (inspecionadas em 2026-09-23)

| Fonte                 | Status                                        | Como funciona                                                                                                                                                                                                                                                                        |
| --------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **C&A** (`ca`)        | ✅ Implementado e validado contra o site real | Catálogo público VTEX em JSON: `/api/catalog_system/pub/products/search/{termo ou categoria}?_from=&_to=`. Sem browser. `crawl()` percorre `Source.config.categories` (padrão: `moda-feminina/roupas`, `moda-masculina/roupas`)                                                      |
| **Renner** (`renner`) | ✅ Implementado e validado contra o site real | `crawl()`: sitemap público de produtos → visita só URLs cujo slug indica vestuário/calçado → página do produto via HTTP + Cheerio (JSON-LD `Product` + `__NEXT_DATA__`). `search()`: a página `/b?Ntt=` é renderizada no cliente, então usa **Playwright** apenas para coletar links |
| **Amazon** (`amazon`) | ⚠️ Adapter preparado, **sem coleta**          | Os termos de uso da Amazon não permitem scraping, e isso não é implementado. O `AmazonCrawler` depende de um `AmazonCatalogProvider` (API oficial, afiliados ou feed). Sem provedor, o job falha com erro claro e sem retry. A fonte vem **desabilitada** no seed                    |

### Scraping responsável

- User-Agent identificável (`CRAWLER_USER_AGENT`), sem se passar por navegador.
- Uma requisição por vez por loja, com intervalo mínimo (`CRAWLER_REQUEST_DELAY`), timeout e
  retry com backoff apenas para erros transitórios (5xx, 429 — respeitando `Retry-After`).
- `401/403` interrompe o crawl (`AccessDeniedError`): **não há bypass** de CAPTCHA, anti-bot,
  login ou paywall. Nenhuma credencial/cookie de loja é armazenada.
- URLs respeitam o `robots.txt` verificado: na C&A não são usados os parâmetros bloqueados
  (`ft=`, `fq=`, `O=`, `map=`) — termo e categoria vão no caminho; na Renner, `/p/`, `/b` e os
  sitemaps são permitidos.
- Playwright só onde há dependência real de JavaScript; um único browser é reutilizado,
  com contexto isolado por página e sem baixar imagens/fontes.

### Normalização (determinística, sem IA)

`src/modules/crawlers/normalizer/` — dicionários em `dictionaries.ts`:

- **Nome**: espaços colapsados; nomes todo em minúsculo (C&A) viram Title Case.
- **Slug**: `Camisa Masculina Preta Slim` → `camisa-masculina-preta-slim` (não é identificador).
- **Gênero**: `masculino | feminino | unissex | infantil`, a partir do campo da loja, depois
  nome, categoria e início da descrição (`masculina`, `mulher`, `menino`… são sinônimos).
- **Cor**: valor canônico (`preta` → `preto`, `azul marinho` → `azul`, `off white` → `off-white`).
- **Categoria**: primeira palavra-chave do nome (o substantivo principal: "Blusa de Moletom" é
  blusa); fallback para o caminho de categoria da loja. Itens como perfume ou "body splash" não
  recebem categoria de vestuário.
- **Preço**: aceita `139.9`, `"139,90"`, `"R$ 1.299,90"`; precisa ser > 0. `originalPrice` só é
  mantido se for maior que o preço.
- **Disponibilidade**, URLs absolutas (`//img…` → `https://img…`), até 10 imagens sem duplicatas.
- **`searchText`**: nome + marca + cor + categoria + gênero, sem acentos — base da busca.

Produtos inválidos (sem id, nome, preço ou URL) contam em `productsFailed`.

Teste manual contra a loja real (não grava no banco):

```bash
npm run crawl:manual -- ca search "vestido preto" 3
npm run crawl:manual -- renner crawl 3
npm run crawl:manual -- renner search "camisa" 3      # requer chromium do Playwright
```

## API

Todas as rotas de negócio usam o prefixo **`/api/v1`**. Formato de resposta:

```jsonc
// item único
{ "data": { ... } }
// coleções paginadas (products, jobs)
{ "data": [ ... ], "pagination": { "page": 1, "pageSize": 20, "total": 0, "totalPages": 0 } }
// coleções pequenas e limitadas (sources, categories)
{ "data": [ ... ] }
// erro
{ "error": { "code": "PRODUCT_NOT_FOUND", "message": "Product not found" } }
```

| Método | Rota                                           | Descrição                                                                    |
| ------ | ---------------------------------------------- | ---------------------------------------------------------------------------- |
| GET    | `/health`, `/health/database`, `/health/redis` | Health checks (503 se a dependência falhar)                                  |
| GET    | `/api/v1/products`                             | Lista com filtros, ordenação e paginação                                     |
| GET    | `/api/v1/products/search?q=`                   | Busca textual (`q` obrigatório), mesmos filtros                              |
| GET    | `/api/v1/products/:id`                         | Detalhe (com imagens; nunca inclui `rawData`)                                |
| GET    | `/api/v1/categories?tree=&parent=`             | Categorias (plana ou em árvore)                                              |
| GET    | `/api/v1/sources`                              | Fontes com `productsCount` e `crawlerAvailable`                              |
| GET    | `/api/v1/sources/:id`                          | Detalhe da fonte                                                             |
| PATCH  | `/api/v1/sources/:id`                          | Atualiza `name`, `baseUrl`, `enabled`, `crawlInterval`, `maxPages`, `config` |
| POST   | `/api/v1/sources/:id/sync`                     | Enfileira crawl → `202` com o `CrawlJob`                                     |
| GET    | `/api/v1/sources/:id/jobs`                     | Histórico de crawls (paginado)                                               |
| GET    | `/api/v1/crawl-jobs/:id`                       | Status e métricas de um crawl                                                |

**Filtros de produtos**: `q`, `category` (slug, inclui subcategorias), `gender`, `brand`,
`color`, `source` (slug), `minPrice`, `maxPrice`, `available`, `sort`
(`relevance` | `price_asc` | `price_desc` | `newest` — whitelist), `page` (≥1),
`pageSize` (1–100, padrão 20).

**Busca**: sem acentos e sem diferenciar maiúsculas; todos os termos precisam casar; cor e gênero
viram o valor canônico e plural simples é ignorado (`calças pretas` encontra "Calça … Preto").
Com `sort=relevance`, ordena por similaridade trigram.

**Sync** — corpo opcional:

```json
{ "mode": "crawl", "limit": 100 }
{ "mode": "search", "query": "camisa preta", "limit": 20 }
```

Erros: `404 SOURCE_NOT_FOUND`, `409 SOURCE_DISABLED`, `409 CRAWLER_NOT_AVAILABLE`,
`409 CRAWL_ALREADY_RUNNING`, `502 EXTERNAL_SERVICE_ERROR` (fila indisponível).

### Exemplos (curl)

```bash
curl http://localhost:3333/health
curl http://localhost:3333/health/database
curl "http://localhost:3333/api/v1/products"
curl "http://localhost:3333/api/v1/products?q=vestido&gender=feminino&color=preto&maxPrice=300"
curl "http://localhost:3333/api/v1/products/search?q=camisa"
curl "http://localhost:3333/api/v1/products/{id}"
curl "http://localhost:3333/api/v1/categories?tree=true"
curl "http://localhost:3333/api/v1/sources"

# sincronizar (use o id retornado em /sources)
curl -X POST "http://localhost:3333/api/v1/sources/{id}/sync"
curl -X POST -H 'content-type: application/json' \
  -d '{"mode":"search","query":"camisa preta","limit":10}' \
  "http://localhost:3333/api/v1/sources/{id}/sync"
curl "http://localhost:3333/api/v1/crawl-jobs/{crawlJobId}"

# configurar fonte
curl -X PATCH -H 'content-type: application/json' \
  -d '{"crawlInterval":360,"maxPages":200}' \
  "http://localhost:3333/api/v1/sources/{id}"
```

## Swagger

Documentação OpenAPI interativa em **http://localhost:3333/docs** (JSON em `/docs/json`),
com parâmetros, schemas de resposta, erros e exemplos.

## Integração com o provador

O provador faz apenas HTTP:

```http
GET /api/v1/products/search?q=camisa%20preta&gender=masculino&pageSize=20
```

```json
{
  "data": [
    {
      "id": "0b7c…",
      "externalId": "4558067",
      "name": "Camisa Masculina Preta Slim",
      "slug": "camisa-masculina-preta-slim",
      "brand": "Renner",
      "category": { "id": "…", "name": "Camisas", "slug": "camisas" },
      "gender": "masculino",
      "color": "preto",
      "size": "P, M, G",
      "price": 129.9,
      "originalPrice": 159.9,
      "currency": "BRL",
      "imageUrl": "https://…jpg",
      "productUrl": "https://…",
      "available": true,
      "source": { "id": "…", "name": "Renner", "slug": "renner" },
      "lastScrapedAt": "2026-09-23T21:24:19.197Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
}
```

Para favoritos/looks, guarde o `id` do produto e use `GET /api/v1/products/{id}` (inclui todas as
imagens). O provador não precisa saber como o produto foi coletado, qual crawler foi usado,
como o HTML foi processado, nem como Redis/BullMQ funcionam. Configure `CORS_ORIGIN` com a
origem do provador.

## Testes

```bash
docker compose up -d postgres redis   # necessários para os testes de integração
npm test                 # todos (unit + integration)
npm run test:unit        # só unitários (não precisa de banco)
npm run test:integration
npm run test:coverage
npm run test:watch
```

- **Unitários**: normalizer, slug/texto/preço, busca, parsers e mappers (com **fixtures reais**
  salvos das lojas em `tests/fixtures/`), crawlers com `fetch` falso, HttpClient (retry, 403,
  delay), CacheService, CrawlerRegistry, ProductService, CrawlRunner.
- **Integração** (Postgres + Redis reais): API de produtos/busca/categorias, API de fontes/sync,
  health/Swagger, fluxo de crawl com idempotência e concorrência, fila BullMQ + worker real.
- Os testes usam o banco **`catalog_test`** (criado pelo `docker/postgres/init`) e o Redis db `1`;
  o helper se recusa a limpar um banco cujo nome não contenha `test`. Nenhum teste automatizado
  acessa a internet.

## Desenvolvimento

```bash
npm run dev            # API com hot reload
npm run worker         # worker
npm run lint           # ESLint (lint:fix para corrigir)
npm run format         # Prettier (format:check no CI)
npm run typecheck      # tsc --noEmit
npm run build          # compila para dist/
```

O CI (`.github/workflows/ci.yml`) roda: install → prisma generate/validate → lint → format
check → typecheck → testes (com Postgres/Redis de serviço) → build, e valida o build da imagem
Docker de produção.

## Produção

Checklist:

- `NODE_ENV=production`, `CORS_ORIGIN` com as origens reais (nunca `*`).
- `npm run db:deploy` antes de subir a nova versão (migrations).
- Rodar API (`node dist/server.js`) e worker (`node dist/worker.js`) como processos separados;
  escalar horizontalmente conforme necessário. Ligar `SCHEDULER_ENABLED=true` para as
  sincronizações periódicas (é seguro em vários workers: o scheduler do BullMQ é idempotente).
- Redis com persistência e `maxmemory-policy noeviction` (exigido pelo BullMQ).
- Health checks: `/health` (liveness), `/health/database` e `/health/redis` (readiness).
- Logs em JSON (Pino) com `x-request-id`; headers `authorization`, `cookie` e `x-api-key` são
  redigidos. Em produção stack traces não são expostos.
- Segurança já ativa: Helmet, CORS, rate limit (compartilhado via Redis), limite de payload,
  timeout de requisição, validação Zod em toda entrada.
- Autenticação: a API foi pensada para uso interno. Para expor publicamente, adicione um hook
  `onRequest` no escopo `/api/v1` em `app.ts` validando `X-API-Key` ou `Authorization: Bearer`.

## Adicionando uma nova loja

Exemplo: `src/modules/crawlers/nova-loja/`.

1. **Criar a source no banco** — adicione ao `prisma/seed.ts` (ou insira direto) com um `slug`
   único, ex. `nova-loja`.
2. **Inspecionar a loja**: `robots.txt`, termos de uso, se há API/JSON público, JSON-LD ou se o
   conteúdo depende de JavaScript. Salve respostas reais em `tests/fixtures/`.
3. **Criar o crawler** `nova-loja.crawler.ts` implementando `Crawler` (`source = 'nova-loja'`,
   `search()` e `crawl()` retornando `AsyncIterable<CrawlItem>`). Use o `HttpClient` do contexto
   (delay/retry/timeout) e o `BrowserPool` só se precisar de JavaScript.
4. **Criar o parser** `nova-loja.parser.ts`: interpreta HTML (Cheerio) ou JSON (valide com Zod).
5. **Criar o mapper** `nova-loja.mapper.ts`: converte para `ScrapedProduct`. Normalização
   (gênero/cor/categoria/preço) é automática; ajuste `normalizer/dictionaries.ts` se a loja
   usar termos novos.
6. **Registrar** em `src/modules/crawlers/crawler.factory.ts`:
   `.register(new NovaLojaCrawler(context.createHttpClient()))`.
7. **Criar testes** em `tests/unit/nova-loja.crawler.test.ts` com os fixtures e `fakeFetch`.
8. **Executar sync**: `npm run crawl:manual -- nova-loja search "camisa" 3` e depois
   `POST /api/v1/sources/{id}/sync`.
9. **Verificar produtos**: `GET /api/v1/crawl-jobs/{id}` e
   `GET /api/v1/products?source=nova-loja`.

Nada em products/sources/worker precisa mudar.

## Troubleshooting

| Sintoma                                         | Causa / solução                                                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `Invalid environment variables` ao iniciar      | Falta `.env` ou variável inválida: `cp .env.example .env`                                                             |
| `Can't reach database server at localhost:5433` | `docker compose up -d postgres` e aguarde ficar healthy                                                               |
| `port is already allocated` (5432/6379/3333)    | Outro serviço usa a porta; ajuste o mapeamento em `docker-compose.yml` e as URLs no `.env`                            |
| Testes: `Could not migrate the test database`   | Postgres parado ou volume antigo sem `catalog_test`: `docker compose exec postgres createdb -U postgres catalog_test` |
| `/health/redis` 503                             | Redis parado ou `REDIS_URL` errada                                                                                    |
| Sync fica `PENDING`                             | Worker não está rodando (`npm run worker` / `docker compose logs -f worker`)                                          |
| `409 CRAWL_ALREADY_RUNNING`                     | Já existe crawl ativo para a fonte. Jobs sem progresso por 30 min são considerados abandonados                        |
| Job `FAILED` com `Access denied (403)`          | A loja bloqueou o acesso. Não contornamos; reduza a frequência ou use uma fonte autorizada                            |
| Job `COMPLETED` com `productsFound = 0`         | Estrutura da loja pode ter mudado; compare com os fixtures e ajuste o parser                                          |
| `Playwright browser unavailable`                | `npx playwright install chromium` (já incluído na imagem Docker)                                                      |
| Busca não reflete produto recém-atualizado      | Cache de busca expira em `CACHE_TTL` (5 min); o detalhe é invalidado na hora                                          |

## Roadmap

- Crawl incremental da Renner (cursor no sitemap: hoje cada execução percorre o sitemap desde o
  início até o limite).
- Integração Amazon via fonte autorizada (`AmazonCatalogProvider`).
- Processamento de imagens → object storage/CDN (`imageCachedUrl`, `imageProcessingStatus`).
- `PriceHistory`, `ProductVariant` (tamanho/cor por SKU), `Brand`.
- Aquisição sob demanda: busca sem resultado → enfileira `search` nas fontes → catálogo.
- PostgreSQL Full Text Search (e Meilisearch se a escala justificar).
- `SearchQuery` para analytics, embeddings/similaridade para recomendação.
- Autenticação por API key quando a API for exposta fora da rede interna.
