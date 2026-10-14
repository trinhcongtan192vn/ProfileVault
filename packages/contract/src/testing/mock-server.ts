import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SubmitJobRequestSchema, matchesFilter, type ApiAccount, type ApiJob } from '../api-v1.js';
import { CONTRACT_VERSION } from '../version.js';

/**
 * Server giả lập `profilevault/v1` cho app gọi phát triển offline (SPEC-06 §7, SPEC-09 §5).
 * Cùng mã lỗi/HTTP status với ProfileVault thật; không chạy flow — test tự chuyển trạng thái job bằng `complete()`.
 */
export interface MockClient { token: string; scopes: string[]; flowFilter?: string[] }
export type MockAccount = Omit<ApiAccount, 'flows'>;
export interface MockFlow { flowId: string; version: string; minLevel: number; modes: ('L2' | 'L3')[] }

const STATUS: Record<string, number> = { INPUT_INVALID: 400, UNAUTHORIZED: 401, FORBIDDEN_SCOPE: 403, ACCOUNT_NOT_BOUND: 404, FLOW_NOT_FOUND: 404, LEVEL_TOO_LOW: 422, BINDING_PAUSED: 422, FLOW_DISABLED: 422 };

export class MockProfileVault {
  private server: Server | null = null;
  baseUrl = '';
  readonly jobs: (ApiJob & { clientToken: string; idempotencyKey: string })[] = [];

  constructor(
    readonly opts: {
      clients: MockClient[];
      accounts: MockAccount[];
      flows?: MockFlow[];
    },
  ) {}

  get flows(): MockFlow[] {
    return this.opts.flows ?? [{ flowId: 'youtube/session-check', version: '1.0.0', minLevel: 1, modes: [] }, { flowId: 'youtube/upload', version: '1.0.0', minLevel: 2, modes: ['L2', 'L3'] }];
  }

  async start(): Promise<string> {
    const server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    this.server = server;
    this.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return this.baseUrl;
  }
  async stop(): Promise<void> {
    const s = this.server;
    this.server = null;
    if (s) await new Promise<void>((r) => { s.closeAllConnections(); s.close(() => r()); });
  }
  /** Chuyển job sang kết thúc (giả lập Runner). */
  complete(jobId: string, result: unknown): void {
    const j = this.jobs.find((x) => x.id === jobId);
    if (j) Object.assign(j, { status: 'done', result, progress: { ...j.progress, percent: 100 }, updatedAt: new Date().toISOString() });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    const fail = (code: string, message: string, detail?: Record<string, unknown>) => send(STATUS[code] ?? 500, { error: { code, message, ...(detail ? { detail } : {}) } });
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const token = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
    const client = this.opts.clients.find((c) => c.token === token);
    if (!client) return fail('UNAUTHORIZED', 'Token không hợp lệ');
    const need = (scope: string) => client.scopes.includes(scope);
    const flowFilter = client.flowFilter ?? ['*'];
    const p = url.pathname;

    if (req.method === 'GET' && p === '/api/v1/health') return send(200, { service: 'ok', fury: { reachable: true, version: '0.3.22', supported: true }, contractVersion: CONTRACT_VERSION });
    if (req.method === 'GET' && p === '/api/v1/accounts') {
      if (!need('accounts.read')) return fail('FORBIDDEN_SCOPE', 'Thiếu accounts.read');
      const platform = url.searchParams.get('platform');
      return send(200, {
        accounts: this.opts.accounts
          .filter((a) => !platform || a.platform === platform)
          .map((a) => ({ ...a, flows: a.paused ? [] : this.flows.filter((f) => matchesFilter(f.flowId, flowFilter) && a.level >= f.minLevel).map((f) => (f.modes.length ? { flowId: f.flowId, mode: a.level >= 3 ? 'L3' : 'L2' } : { flowId: f.flowId })) })),
      });
    }
    if (req.method === 'GET' && p === '/api/v1/flows') {
      if (!need('jobs.read')) return fail('FORBIDDEN_SCOPE', 'Thiếu jobs.read');
      return send(200, { flows: this.flows.filter((f) => matchesFilter(f.flowId, flowFilter)).map((f) => ({ ...f, inputSchema: null, outputSchema: null })) });
    }
    if (req.method === 'POST' && p === '/api/v1/jobs') {
      const raw = await readJson(req);
      const parsed = SubmitJobRequestSchema.safeParse(raw);
      if (!parsed.success) return fail('INPUT_INVALID', 'Yêu cầu job sai schema', { issues: parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })) });
      const r = parsed.data;
      if (!need('jobs.write') || !matchesFilter(r.flowId, flowFilter)) return fail('FORBIDDEN_SCOPE', 'Client không có quyền');
      const dup = this.jobs.find((j) => j.clientToken === token && j.idempotencyKey === r.idempotencyKey);
      if (dup) return send(200, strip(dup), { 'x-pv-duplicate': 'true' });
      const flow = this.flows.find((f) => f.flowId === r.flowId);
      if (!flow) return fail('FLOW_NOT_FOUND', 'Không có flow');
      const acc = r.account ? this.opts.accounts.find((a) => a.platform === r.account!.platform && a.accountId === r.account!.accountId) : undefined;
      if (!acc) return fail('ACCOUNT_NOT_BOUND', 'Tài khoản chưa được gắn');
      if (acc.paused) return fail('BINDING_PAUSED', 'Kênh đang bị dừng');
      if (acc.level < flow.minLevel) return fail('LEVEL_TOO_LOW', `Kênh ở L${acc.level}, flow cần L${flow.minLevel}`);
      const now = new Date().toISOString();
      const job = {
        id: `jb_${String(this.jobs.length + 1).padStart(26, '0')}`,
        flowId: r.flowId,
        account: { platform: acc.platform, accountId: acc.accountId },
        status: 'queued' as const,
        mode: flow.modes.length ? (acc.level >= 3 ? ('L3' as const) : ('L2' as const)) : null,
        progress: { step: null, stepIndex: 0, stepCount: null, percent: null },
        needsUser: null,
        result: null,
        error: null,
        createdAt: now,
        updatedAt: now,
        clientToken: token!,
        idempotencyKey: r.idempotencyKey,
      };
      this.jobs.push(job);
      return send(201, strip(job));
    }
    const m = /^\/api\/v1\/jobs\/([^/]+)(\/cancel)?$/.exec(p);
    if (m) {
      const job = this.jobs.find((j) => j.id === m[1] && j.clientToken === token);
      if (m[2] && req.method === 'POST') {
        if (!need('jobs.write')) return fail('FORBIDDEN_SCOPE', 'Thiếu jobs.write');
        if (!job) return fail('INPUT_INVALID', 'Không có job này');
        if (!['done', 'failed', 'cancelled'].includes(job.status)) Object.assign(job, { status: 'cancelled', error: { code: 'CANCELLED', message: 'Job đã bị hủy', detail: null } });
        return send(200, strip(job));
      }
      if (req.method === 'GET') {
        if (!need('jobs.read')) return fail('FORBIDDEN_SCOPE', 'Thiếu jobs.read');
        return job ? send(200, strip(job)) : fail('INPUT_INVALID', 'Không có job này');
      }
    }
    if (req.method === 'GET' && p === '/api/v1/jobs') {
      if (!need('jobs.read')) return fail('FORBIDDEN_SCOPE', 'Thiếu jobs.read');
      const mine = this.jobs.filter((j) => j.clientToken === token).slice().reverse();
      return send(200, { jobs: mine.slice(0, Number(url.searchParams.get('limit') ?? 50)).map(strip), nextCursor: null });
    }
    return send(404, { error: { code: 'FLOW_NOT_FOUND', message: 'Không có đường dẫn này' } });
  }
}

function strip(j: ApiJob & { clientToken?: string; idempotencyKey?: string }): ApiJob {
  const { clientToken: _t, idempotencyKey: _k, ...rest } = j;
  return rest;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
}
