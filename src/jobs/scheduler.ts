import type { BullCrawlerQueue } from '../infrastructure/queue/queues/crawler.queue.js';
import type { SourceRepository } from '../modules/sources/source.repository.js';
import type { Logger } from '../shared/utils/logger.js';

/**
 * Sincroniza os agendamentos do BullMQ com a configuração das fontes:
 * cada Source habilitada com `crawlInterval` (minutos) ganha um job repetível `sync-source`;
 * fontes desabilitadas ou sem intervalo têm o agendamento removido.
 *
 * Ex.: Renner e C&A com crawlInterval = 360 -> sincronização a cada 6 horas.
 */
export async function syncSchedules(
  queue: BullCrawlerQueue,
  sources: SourceRepository,
  logger: Logger,
): Promise<void> {
  const scheduled = await sources.findScheduled();
  const wanted = new Set<string>();

  for (const source of scheduled) {
    if (!source.crawlInterval) continue;
    wanted.add(`sync:${source.slug}`);
    await queue.scheduleSync(source.slug, { sourceId: source.id }, source.crawlInterval);
    logger.info({ source: source.slug, everyMinutes: source.crawlInterval }, 'sync scheduled');
  }

  for (const id of await queue.listSchedulerIds()) {
    if (!wanted.has(id)) {
      await queue.removeScheduler(id);
      logger.info({ scheduler: id }, 'sync schedule removed');
    }
  }
}
