import type { FastifyReply, FastifyRequest } from 'fastify';
import { ok } from '../../shared/http/response.js';
import {
  listJobsQuerySchema,
  sourceParamsSchema,
  syncSourceBodySchema,
  updateSourceBodySchema,
} from './source.schema.js';
import type { SourceService } from './source.service.js';

export class SourceController {
  constructor(private readonly service: SourceService) {}

  list = async () => ok(await this.service.list());

  getById = async (request: FastifyRequest) => {
    const { id } = sourceParamsSchema.parse(request.params);
    return ok(await this.service.getById(id));
  };

  update = async (request: FastifyRequest) => {
    const { id } = sourceParamsSchema.parse(request.params);
    const body = updateSourceBodySchema.parse(request.body);
    return ok(await this.service.update(id, body));
  };

  sync = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = sourceParamsSchema.parse(request.params);
    const body = syncSourceBodySchema.parse(request.body ?? {});
    const job = await this.service.requestSync(id, body);
    request.log.info({ sourceId: id, crawlJobId: job.id, mode: body.mode }, 'crawl job enqueued');
    return reply.status(202).send(ok(job));
  };

  listJobs = async (request: FastifyRequest) => {
    const { id } = sourceParamsSchema.parse(request.params);
    const pagination = listJobsQuerySchema.parse(request.query);
    return this.service.listJobs(id, pagination);
  };
}
