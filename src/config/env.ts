import { existsSync } from 'node:fs';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const envSchema = z.object({
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

  CACHE_TTL: z.coerce.number().int().positive().default(300),
  CACHE_PRODUCT_TTL: z.coerce.number().int().positive().default(600),

  CRAWLER_TIMEOUT: z.coerce.number().int().positive().default(30_000),
  CRAWLER_MAX_RETRIES: z.coerce.number().int().min(1).max(10).default(3),
  CRAWLER_REQUEST_DELAY: z.coerce.number().int().min(0).default(1_000),
  CRAWLER_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(1),
  CRAWLER_USER_AGENT: z.string().default('CatalogServiceBot/0.1'),
  SCHEDULER_ENABLED: booleanString.default(false),
});

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

export const corsOrigins = env.CORS_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
