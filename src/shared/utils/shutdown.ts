export interface ShutdownLogger {
  info(obj: object | string, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export type ShutdownStep = [name: string, close: () => Promise<unknown>];

const FORCE_EXIT_MS = 30_000;

/**
 * Graceful shutdown em SIGTERM/SIGINT: executa os passos em ordem
 * (parar de aceitar requisições/jobs -> fechar filas -> Redis -> Prisma) e encerra.
 */
export function registerShutdown(logger: ShutdownLogger, steps: ShutdownStep[]): void {
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    const forceExit = setTimeout(() => {
      logger.error({ signal }, 'graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, FORCE_EXIT_MS);
    forceExit.unref();

    let exitCode = 0;
    for (const [name, close] of steps) {
      try {
        await close();
        logger.info({ step: name }, 'closed');
      } catch (error) {
        exitCode = 1;
        logger.error({ err: error, step: name }, 'failed to close');
      }
    }
    process.exit(exitCode);
  };

  process.once('SIGTERM', (signal) => void shutdown(signal));
  process.once('SIGINT', (signal) => void shutdown(signal));
}
