import { existsSync } from 'node:fs';
import { z } from 'zod';
import { COUNTRY_CODE, GOOGLE_DOMAIN, LANGUAGE_TAG } from '../shared/utils/market.js';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const envObjectSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3333),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  BODY_LIMIT: z.coerce.number().int().positive().default(1_048_576),
  REQUEST_TIMEOUT: z.coerce.number().int().positive().default(15_000),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  /**
   * IPs/redes fora do rate limit por IP, separados por vírgula (ex.: "172.31.37.117" = backend na
   * VPC). O IP é o da conexão (não o X-Forwarded-For). Vazio = todos limitados.
   */
  RATE_LIMIT_ALLOWLIST: z.string().default(''),

  CACHE_TTL: z.coerce.number().int().positive().default(300),
  CACHE_PRODUCT_TTL: z.coerce.number().int().positive().default(600),

  CRAWLER_TIMEOUT: z.coerce.number().int().positive().default(30_000),
  CRAWLER_MAX_RETRIES: z.coerce.number().int().min(1).max(10).default(3),
  CRAWLER_REQUEST_DELAY: z.coerce.number().int().min(0).default(1_000),
  CRAWLER_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(1),
  CRAWLER_USER_AGENT: z.string().default('CatalogServiceBot/0.1'),
  SCHEDULER_ENABLED: booleanString.default(false),
  /**
   * Lojas desligadas por configuração (slugs separados por vírgula, ex.: "amazon,ca"): ficam fora
   * do registro de crawlers — sync manual responde CRAWLER_NOT_AVAILABLE e o agendador não as
   * agenda. Útil pra desligar uma loja sem mexer no banco (ex.: provider de API sem credencial).
   */
  CRAWLER_DISABLED_SOURCES: z.string().default(''),
  /**
   * Peça não vista numa sincronização completa há mais que isto (dias) vira indisponível — saiu
   * da loja. Só roda depois de uma sincronização que terminou bem e achou peças.
   */
  STALE_PRODUCT_DAYS: z.coerce.number().int().min(1).max(90).default(3),

  /**
   * Busca ao vivo no Google Shopping (GET /api/v1/providers/google-shopping/search).
   * "serpapi" = API paga e autorizada (recomendado em produção); "browser" = Playwright, só pra
   * testes locais (o Google responde CAPTCHA a tráfego automatizado e isso NUNCA é contornado);
   * "disabled" = endpoint responde GOOGLE_SHOPPING_UNAVAILABLE sem acessar nada.
   */
  GOOGLE_SHOPPING_FETCHER: z.enum(['disabled', 'serpapi', 'browser']).default('disabled'),
  GOOGLE_SHOPPING_SERPAPI_KEY: z.string().optional(),
  /** Mercado padrão (ISO 3166-1 alpha-2) e idioma; a requisição pode trocar os dois. */
  GOOGLE_SHOPPING_COUNTRY: z
    .string()
    .regex(COUNTRY_CODE)
    .transform((value) => value.toUpperCase())
    .default('BR'),
  GOOGLE_SHOPPING_LANGUAGE: z.string().regex(LANGUAGE_TAG).default('pt-BR'),
  /** Domínio do Google usado nas buscas (só google.<tld>). */
  GOOGLE_SHOPPING_DOMAIN: z.string().regex(GOOGLE_DOMAIN).default('google.com.br'),
  /** Moeda assumida quando o preço não traz símbolo reconhecível. */
  GOOGLE_SHOPPING_CURRENCY: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('BRL'),
  GOOGLE_SHOPPING_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(3).default(1),
  /** Buscas esperando a vez além das que estão rodando; acima disso responde "indisponível". */
  GOOGLE_SHOPPING_MAX_QUEUE: z.coerce.number().int().min(0).max(50).default(5),
  /** Intervalo mínimo entre o início de duas buscas no Google (ms). */
  GOOGLE_SHOPPING_REQUEST_DELAY_MS: z.coerce.number().int().min(0).default(3_000),
  /** Tempo máximo da busca inteira: fila + tentativas + extração (ms). */
  GOOGLE_SHOPPING_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(25_000),
  GOOGLE_SHOPPING_NAVIGATION_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(15_000),
  GOOGLE_SHOPPING_SELECTOR_TIMEOUT_MS: z.coerce.number().int().min(500).default(8_000),
  /** Tentativas por busca (só falhas passageiras; bloqueio/CAPTCHA nunca é repetido). */
  GOOGLE_SHOPPING_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(3).default(2),
  /** Quantos produtos guardar por busca (a paginação do endpoint anda sobre esse lote). */
  GOOGLE_SHOPPING_MAX_PRODUCTS: z.coerce.number().int().min(1).max(100).default(60),
  /** Cache do lote de resultados de uma busca (segundos). Cada busca na SerpApi é paga. */
  GOOGLE_SHOPPING_CACHE_TTL: z.coerce.number().int().positive().default(3_600),
});

const envSchema = envObjectSchema.refine(
  (value) => value.GOOGLE_SHOPPING_FETCHER !== 'serpapi' || value.GOOGLE_SHOPPING_SERPAPI_KEY,
  {
    path: ['GOOGLE_SHOPPING_SERPAPI_KEY'],
    message: 'required when GOOGLE_SHOPPING_FETCHER=serpapi',
  },
);

export type Env = z.infer<typeof envSchema>;

function loadDotEnvFile(): void {
  // Variáveis já definidas no ambiente (Docker, CI, testes) têm precedência sobre o .env.
  if (!existsSync('.env')) return;
  process.loadEnvFile('.env');
}

function loadEnv(): Env {
  loadDotEnvFile();
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();

/** "Amazon, ca" -> {"amazon", "ca"} */
export function parseSourceList(value: string): ReadonlySet<string> {
  return new Set(
    value
      .split(',')
      .map((slug) => slug.trim().toLowerCase())
      .filter(Boolean),
  );
}

export const disabledSources = parseSourceList(env.CRAWLER_DISABLED_SOURCES);

export const corsOrigins = env.CORS_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
