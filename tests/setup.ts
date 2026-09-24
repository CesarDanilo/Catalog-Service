// Executado antes de cada arquivo de teste, antes de qualquer import de src/.
// Variáveis já definidas (ex.: no CI) têm precedência.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL ??= 'silent';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/catalog_test?schema=public';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1';
process.env.CRAWLER_REQUEST_DELAY = '0';
process.env.RATE_LIMIT_MAX ??= '1000';
