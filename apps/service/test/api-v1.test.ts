import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { FakeClock, type AutomationLevel } from '@sctech/profilevault-contract';
import { MemorySecretStore } from '@sctech/profilevault-core';
import { FakeTimers, HttpFuryClient } from '@sctech/profilevault-fury-client';
import { FakeFury } from '@sctech/profilevault-fury-client/testing';
import { bootstrap, type ServiceContext } from '../src/bootstrap.js';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'pv-api-'));
  dirs.push(d);
  return d;
};

let fake: FakeFury;
let ctx: ServiceContext;
let base: string;
let cookie: string;
let csrf: string;

async function internal(method: string, url: string, body?: unknown) {
  const res = await fetch(`${base}${url}`, { method, headers: { cookie, 'x-pv-csrf': csrf, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> };
}
async function token(scopes: string[], extra: Record<string, unknown> = {}): Promise<string> {
  const r = await internal('POST', '/internal/clients', { name: `app-${scopes.join('-')}`, scopes, ...extra });
  expect(r.status).toBe(201);
  return r.body.token as string;
}
async function api(tok: string | null, method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${url}`, { method, headers: { ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, headers: res.headers, body: (await res.json().catch(() => null)) as Record<string, unknown> };
}
async function binding(n: number, level: AutomationLevel) {
  fake.upsertProfile({ id: `p${n}`, name: `Kênh ${n}`, personaId: `win-${n}`, os: 'windows' });
  const b = await ctx.health.createBinding({ platform: 'youtube', accountId: `UCkenh${n}xxxxxxxxxxxx`, displayName: `Kênh ${n}`, furyProfileId: `p${n}`, marketCountry: 'VN' });
  const repos = ctx.healthBundle.repos;
  repos.bindings.setLevel(b.id, level, ctx.clock.nowIso());
  for (const p of repos.pauses.listOpen(b.id)) repos.pauses.clear(p.id, ctx.clock.nowIso(), 'system');
  return ctx.health.getBinding(b.id)!;
}

beforeEach(async () => {
  fake = new FakeFury({ version: '0.3.22' });
  await fake.start();
  const appData = tmp();
  mkdirSync(appData, { recursive: true });
  writeFileSync(path.join(appData, 'config.json'), JSON.stringify({ gateway: { host: '127.0.0.1', port: 0 } }));
  const timers = new FakeTimers();
  const clock = new FakeClock('2026-10-15T03:00:00.000Z');
  const fury = new HttpFuryClient({ baseUrl: fake.baseUrl, supportedVersions: '>=0.2.21 <0.4.0', timers, clock, maxRetries: 0 });
  ctx = await bootstrap({ env: { PV_APPDATA_DIR: appData, PV_LOCALAPPDATA_DIR: tmp() }, secretStore: new MemorySecretStore(), clock, timers, fury, pidAlive: () => true, startBackground: false, listen: true });
  base = ctx.gatewayUrl!;
  const open = await fetch(ctx.gateway.createOpenUrl(), { redirect: 'manual' });
  cookie = open.headers.get('set-cookie')!.split(';')[0]!;
  csrf = ((await (await fetch(`${base}/internal/session`, { headers: { cookie } })).json()) as { csrfToken: string }).csrfToken;
});
afterEach(async () => {
  await ctx.shutdown();
  await fake.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('Integration API profilevault/v1 (SPEC-06 §5, SPEC-05 §4.2, §8)', () => {
  it('xác thực Bearer, accounts/flows theo mức, gửi job + idempotency, LEVEL_TOO_LOW, scope hẹp, Host lạ', async () => {
    const l1 = await binding(1, 1);
    await binding(2, 0);
    const full = await token(['accounts.read', 'jobs.read', 'jobs.write']);

    expect((await api(null, 'GET', '/api/v1/health')).status).toBe(401);
    expect((await api('pv_badtoken0_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'GET', '/api/v1/health')).status).toBe(401);
    expect((await api(full, 'GET', '/api/v1/health')).body).toMatchObject({ service: 'ok', contractVersion: 'profilevault/v1', fury: { reachable: true, version: '0.3.22', supported: true } });
    // fetch bỏ qua header Host → dùng http.request
    const evil = await new Promise<number>((resolve, reject) => {
      const r = request(`${base}/api/v1/health`, { headers: { host: 'evil.com', authorization: `Bearer ${full}` } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      r.on('error', reject);
      r.end();
    });
    expect(evil).toBe(403);

    const accounts = (await api(full, 'GET', '/api/v1/accounts?platform=youtube')).body.accounts as { accountId: string; level: number; flows: { flowId: string }[] }[];
    expect(accounts.find((a) => a.accountId === l1.accountId)).toMatchObject({ level: 1, paused: false, flows: expect.arrayContaining([{ flowId: 'youtube/session-check' }]) });
    expect(accounts.find((a) => a.level === 0)!.flows).toEqual([]);
    const flows = (await api(full, 'GET', '/api/v1/flows')).body.flows as { flowId: string; inputSchema: unknown }[];
    expect(flows.map((f) => f.flowId)).toContain('youtube/session-check');

    const req = { flowId: 'youtube/session-check', account: { platform: 'youtube', accountId: l1.accountId }, idempotencyKey: 'app:check:1' };
    const created = await api(full, 'POST', '/api/v1/jobs', req);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ flowId: 'youtube/session-check', status: 'queued', mode: null, account: { platform: 'youtube', accountId: l1.accountId } });
    const dup = await api(full, 'POST', '/api/v1/jobs', req);
    expect(dup.status).toBe(200);
    expect(dup.headers.get('x-pv-duplicate')).toBe('true');
    expect(dup.body.id).toBe(created.body.id);
    expect((await api(full, 'GET', `/api/v1/jobs/${created.body.id as string}`)).body).toMatchObject({ id: created.body.id, status: 'queued' });
    expect(((await api(full, 'GET', '/api/v1/jobs?limit=10')).body.jobs as unknown[]).length).toBe(1);

    const low = await api(full, 'POST', '/api/v1/jobs', { ...req, account: { platform: 'youtube', accountId: 'UCkenh2xxxxxxxxxxxx' }, idempotencyKey: 'low' });
    expect(low.status).toBe(422);
    expect((low.body.error as { code: string }).code).toBe('LEVEL_TOO_LOW');

    const readOnly = await token(['jobs.read']);
    const denied = await api(readOnly, 'POST', '/api/v1/jobs', { ...req, idempotencyKey: 'ro' });
    expect(denied.status).toBe(403);
    expect((denied.body.error as { code: string }).code).toBe('FORBIDDEN_SCOPE');

    const cancelled = await api(full, 'POST', `/api/v1/jobs/${created.body.id as string}/cancel`);
    expect(cancelled.body).toMatchObject({ status: 'cancelled', error: { code: 'CANCELLED' } });

    // Thu hồi token → 401 ngay (cache không giữ quyền cũ)
    const clients = (await internal('GET', '/internal/clients')).body.clients as { id: string; name: string }[];
    await internal('POST', `/internal/clients/${clients.find((c) => c.name.startsWith('app-accounts'))!.id}/revoke`);
    expect((await api(full, 'GET', '/api/v1/health')).status).toBe(401);
    expect(ctx.audit.list({ action: 'job.submit' })).toHaveLength(1);
  });

  it('giới hạn tần suất theo client → 429 RATE_LIMITED + Retry-After', async () => {
    const t = await token(['jobs.read'], { rateLimitPerMin: 2 });
    expect((await api(t, 'GET', '/api/v1/health')).status).toBe(200);
    expect((await api(t, 'GET', '/api/v1/health')).status).toBe(200);
    const limited = await api(t, 'GET', '/api/v1/health');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    (ctx.clock as FakeClock).advance(61_000);
    expect((await api(t, 'GET', '/api/v1/health')).status).toBe(200);
  });
});

describe('MCP Streamable HTTP /mcp (SPEC-05 §6, AT-M1-5)', () => {
  async function mcp(tok: string): Promise<McpClient> {
    const c = new McpClient({ name: 'app-mock', version: '1.0.0' });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${tok}` } } }));
    return c;
  }
  const text = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0]!.text) as Record<string, unknown>;

  it('tool theo scope: token hẹp không thấy tool ghi; không có tool hành động chỉ dành cho người', async () => {
    const narrow = await mcp(await token(['jobs.read']));
    const names = (await narrow.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(['pv_flows_list', 'pv_jobs_get', 'pv_jobs_list', 'pv_jobs_wait']);
    await narrow.close();

    const all = await mcp(await token(['accounts.read', 'jobs.read', 'jobs.write', 'ops.read', 'ops.write']));
    const every = (await all.listTools()).tools.map((t) => t.name);
    expect(every).toHaveLength(15);
    expect(every.some((n) => /promote|clear|checklist|resolve|threshold|rule|token|asn/i.test(n))).toBe(false);
    await all.close();
  });

  it('gửi job qua MCP, đọc tổng quan, lỗi có mã; không token → 401', async () => {
    const l1 = await binding(1, 1);
    const c = await mcp(await token(['accounts.read', 'jobs.read', 'jobs.write', 'ops.read']));
    const accounts = text(await c.callTool({ name: 'pv_accounts_list', arguments: {} }));
    expect((accounts.accounts as unknown[]).length).toBe(1);
    const job = text(await c.callTool({ name: 'pv_jobs_submit', arguments: { flowId: 'youtube/session-check', bindingId: l1.id, idempotencyKey: 'mcp:1' } }));
    expect(job).toMatchObject({ status: 'queued', duplicate: false });
    const again = text(await c.callTool({ name: 'pv_jobs_submit', arguments: { flowId: 'youtube/session-check', bindingId: l1.id, idempotencyKey: 'mcp:1' } }));
    expect(again).toMatchObject({ id: job.id, duplicate: true });
    const bad = await c.callTool({ name: 'pv_jobs_submit', arguments: { flowId: 'youtube/nope', bindingId: l1.id, idempotencyKey: 'mcp:2' } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toMatchObject({ code: 'FLOW_NOT_FOUND' });
    const overview = text(await c.callTool({ name: 'pv_readiness_overview', arguments: {} }));
    expect(overview.rows).toEqual([expect.objectContaining({ bindingId: l1.id, level: 1 })]);
    const waited = text(await c.callTool({ name: 'pv_jobs_wait', arguments: { jobId: job.id, timeoutSeconds: 1 } }));
    expect(waited).toMatchObject({ id: job.id, waited: 'timeout' });
    await c.close();
    expect(ctx.audit.list({ action: 'mcp.tool' }).length).toBeGreaterThanOrEqual(2);
    const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
    expect(res.status).toBe(401);
  });
});
