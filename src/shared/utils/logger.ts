import { pino } from 'pino';
import { env } from '../../config/env.js';

/** Logger estruturado para processos fora do Fastify (worker, scripts). */
export function createLogger(name: string) {
  return pino({
    name,
    level: env.LOG_LEVEL,
    ...(env.NODE_ENV === 'development' && {
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    }),
  });
}

export type Logger = ReturnType<typeof createLogger>;
