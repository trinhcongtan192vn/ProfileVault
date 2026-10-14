import { AccountsQuerySchema, CONTRACT_VERSION, JobIdSchema, JobsListQuerySchema, PvError, type Client } from '@sctech/profilevault-contract';
import type { JobClient } from '@sctech/profilevault-jobs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { GatewayDeps } from '../deps.js';
import { parse } from '../security.js';

declare module 'fastify' {
  interface FastifyRequest {
    client?: Client;
  }
}

export function asJobClient(c: Client): JobClient {
  return { id: c.id, scopes: c.scopes, flowFilter: c.flowFilter, bindingFilter: c.bindingFilter };
}

const JobParams = z.object({ id: JobIdSchema });

/** Integration API `profilevault/v1` (SPEC-06 §5). Xác thực Bearer ở hook của gateway (`req.client`). */
export function registerApiV1Routes(app: FastifyInstance, deps: GatewayDeps): void {
  const jobs = () => {
    if (!deps.jobs) throw new PvError('FLOW_DISABLED', 'Job service chưa sẵn sàng', { reason: 'jobs_missing' });
    return deps.jobs;
  };
  const who = (req: { client?: Client }) => asJobClient(req.client!);

  app.get('/api/v1/health', async () => {
    const h = deps.poller.lastHealth ?? (await deps.fury.health());
    return { service: 'ok' as const, fury: { reachable: h.reachable, version: h.version ?? null, supported: h.supported }, contractVersion: CONTRACT_VERSION };
  });

  app.get('/api/v1/accounts', async (req) => {
    const q = parse(AccountsQuerySchema, req.query ?? {}, 'query');
    return { accounts: jobs().accounts(who(req), q.platform) };
  });

  app.get('/api/v1/flows', async (req) => ({ flows: jobs().flows(who(req)) }));

  app.post('/api/v1/jobs', async (req, reply) => {
    const { job, duplicate } = await jobs().submit(req.body as never, who(req));
    if (duplicate) return reply.code(200).header('X-PV-Duplicate', 'true').send(job);
    return reply.code(201).send(job);
  });

  app.get('/api/v1/jobs', async (req) => {
    const q = parse(JobsListQuerySchema, req.query ?? {}, 'query');
    return jobs().list(who(req), q);
  });

  app.get('/api/v1/jobs/:id', async (req) => {
    const { id } = parse(JobParams, req.params, 'params');
    return jobs().get(id, who(req));
  });

  app.post('/api/v1/jobs/:id/cancel', async (req) => {
    const { id } = parse(JobParams, req.params, 'params');
    return jobs().cancel(id, who(req));
  });
}
