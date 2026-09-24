import type { FastifyRequest } from 'fastify';
import { NotFoundError } from '../../shared/errors/app-error.js';
import { ok } from '../../shared/http/response.js';
import type { CrawlJobRepository } from './crawl-job.repository.js';
import { crawlJobParamsSchema } from './crawl-job.schema.js';

export class CrawlJobController {
  constructor(private readonly repository: CrawlJobRepository) {}

  getById = async (request: FastifyRequest) => {
    const { id } = crawlJobParamsSchema.parse(request.params);
    const job = await this.repository.findById(id);
    if (!job) throw new NotFoundError('CRAWL_JOB_NOT_FOUND', 'Crawl job not found');
    return ok(job);
  };
}
