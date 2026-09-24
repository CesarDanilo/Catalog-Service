import { execSync } from 'node:child_process';

/** Aplica as migrations no banco de teste antes da suíte (exceto em `npm run test:unit`). */
export default function globalSetup(): void {
  if (process.env.UNIT_ONLY === '1') return;
  const databaseUrl =
    process.env.TEST_DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5433/catalog_test?schema=public';
  try {
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    });
  } catch (error) {
    const output = (error as { stderr?: Buffer }).stderr?.toString() ?? String(error);
    throw new Error(
      `Could not migrate the test database (${databaseUrl}). ` +
        `Is Postgres running? (docker compose up -d postgres redis)\n${output}`,
    );
  }
}
