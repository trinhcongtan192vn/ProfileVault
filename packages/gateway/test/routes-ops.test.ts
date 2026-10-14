import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyClientToken } from '../src/index.js';
import { ClientsRepo } from '@sctech/profilevault-db';
import { FakeRunner, makeGateway, type GwHarness } from './helpers.js';

let h: GwHarness;
let runner: FakeRunner;
beforeEach(async () => {
  runner = new FakeRunner();
  h = await makeGateway({ runner });
  h.fake.upsertProfile({ id: 'p1', name: 'Kênh 1', personaId: 'persona-1', os: 'windows' });
});
afterEach(() => h.cleanup());

describe('/internal job/run/lịch/hệ thống qua RunnerFacade', () => {
  it('jobs/flows/runs/cancel/resolve; run lạ → 404; lịch CRUD; system + global-pause/busy-mode', async () => {
    const runId = 'rn_01JAAAAAAAAAAAAAAAAAAAAAAA';
    runner.runs.set(runId, { id: runId, jobId: 'jb_01JAAAAAAAAAAAAAAAAAAAAAAA', bindingId: 'ab_01JAAAAAAAAAAAAAAAAAAAAAAA', flowId: 'youtube/session-check', flowVersion: '1.0.0', status: 'needs_user', currentStep: 'open', attempt: 1, needsUser: { reason: 'custom', message: 'x', choices: [{ id: 'ok', label: 'OK' }], keepProfileOpen: false, since: '2026-10-14T00:00:00.000Z' }, queuedAt: '2026-10-14T00:00:00.000Z', startedAt: null, finishedAt: null, errorCode: null, errorDetail: null, artifactsDir: null, steps: [] });
    expect((await h.api({ method: 'GET', url: '/internal/jobs' })).json()).toEqual({ jobs: [] });
    expect(((await h.api({ method: 'GET', url: '/internal/flows' })).json() as { flows: unknown[] }).flows).toHaveLength(1);
    expect((await h.api({ method: 'GET', url: `/internal/runs/${runId}` })).json()).toMatchObject({ status: 'needs_user' });
    expect((await h.api({ method: 'GET', url: '/internal/runs/rn_01JBBBBBBBBBBBBBBBBBBBBBBB' })).statusCode).toBe(404);
    expect((await h.api({ method: 'POST', url: `/internal/runs/${runId}/cancel` })).statusCode).toBe(204);
    expect((await h.api({ method: 'POST', url: `/internal/runs/${runId}/resolve`, payload: { choice: 'ok' } })).statusCode).toBe(204);
    expect(runner.cancelled).toEqual([runId]);
    expect(runner.resolved).toEqual([{ runId, choice: 'ok' }]);
    expect((await h.api({ method: 'GET', url: `/internal/runs/${runId}/artifacts/log.ndjson` })).statusCode).toBe(404);

    const created = await h.api({ method: 'POST', url: '/internal/schedules', payload: { flowId: 'youtube/session-check', target: { all: true, platform: 'youtube' }, daysOfWeek: '1234567', windowStart: '07:00', windowEnd: '22:00' } });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;
    expect(((await h.api({ method: 'GET', url: '/internal/schedules' })).json() as { schedules: unknown[] }).schedules).toHaveLength(1);
    expect((await h.api({ method: 'PATCH', url: `/internal/schedules/${id}`, payload: { enabled: false } })).json()).toMatchObject({ enabled: false });
    expect((await h.api({ method: 'DELETE', url: `/internal/schedules/${id}` })).statusCode).toBe(204);
    expect((await h.api({ method: 'POST', url: '/internal/schedules', payload: { flowId: 'bad', target: {} } })).statusCode).toBe(400);

    const sys = (await h.api({ method: 'GET', url: '/internal/system' })).json() as { queue: { needsUser: number }; fury: { reachable: boolean }; ramTotalMb: number; packs: unknown[] };
    expect(sys.queue.needsUser).toBe(2);
    expect(sys.fury.reachable).toBe(true);
    expect(sys.ramTotalMb).toBeGreaterThan(0);
    expect(sys.packs).toHaveLength(1);
    expect((await h.api({ method: 'POST', url: '/internal/system/global-pause', payload: { paused: true } })).json()).toEqual({ globalPause: true });
    expect(runner.globalPause).toBe(true);
    expect((await h.api({ method: 'POST', url: '/internal/system/busy-mode', payload: { busy: true } })).json()).toEqual({ busyMode: true });
  });

  it('không có Runner → thao tác 422 FLOW_DISABLED, danh sách rỗng', async () => {
    const g2 = await makeGateway({ port: 50411 });
    try {
      expect((await g2.api({ method: 'GET', url: '/internal/jobs' })).json()).toEqual({ jobs: [] });
      const res = await g2.api({ method: 'POST', url: '/internal/runs/rn_01JAAAAAAAAAAAAAAAAAAAAAAA/cancel' });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ error: { code: 'FLOW_DISABLED' } });
    } finally {
      await g2.cleanup();
    }
  });
});

describe('/internal cài đặt + client', () => {
  it('ngưỡng, luật, runner settings có lịch sử', async () => {
    const t = (await h.api({ method: 'GET', url: '/internal/settings/thresholds' })).json() as { thresholds: { L0_to_L1: unknown[] }; history: unknown[] };
    expect(t.thresholds.L0_to_L1).toHaveLength(7);
    const put = await h.api({ method: 'PUT', url: '/internal/settings/thresholds', payload: { ...t.thresholds, L0_to_L1: [{ kind: 'days_at_level', min: 7 }] } });
    expect(put.statusCode).toBe(200);
    expect(((await h.api({ method: 'GET', url: '/internal/settings/thresholds' })).json() as { history: unknown[] }).history).toHaveLength(2);
    expect((await h.api({ method: 'PUT', url: '/internal/settings/thresholds', payload: { L0_to_L1: [{ kind: 'nope' }] } })).statusCode).toBe(400);

    const rules = (await h.api({ method: 'GET', url: '/internal/rules' })).json() as { rules: { id: string }[] };
    expect(rules.rules).toHaveLength(22);
    const patched = await h.api({ method: 'PATCH', url: '/internal/rules/A3.language_plausible', payload: { enabled: false } });
    expect(patched.json()).toMatchObject({ id: 'A3.language_plausible', enabled: false });
    expect((await h.api({ method: 'PATCH', url: '/internal/rules/Z9.nope', payload: { enabled: false } })).statusCode).toBe(400);

    const rs = (await h.api({ method: 'GET', url: '/internal/settings/runner' })).json() as { runner: { maxConcurrentIdle: number; humanize: { actionDelayMs: number[] } } };
    expect(rs.runner.maxConcurrentIdle).toBe(6);
    expect(rs.runner.humanize.actionDelayMs).toEqual([300, 1200]);
    const putR = await h.api({ method: 'PUT', url: '/internal/settings/runner', payload: { maxConcurrentIdle: 2, humanize: { actionDelayMs: [500, 900], typingDelayMs: [40, 140] }, traceAlways: true } });
    expect(putR.statusCode).toBe(200);
    expect((putR.json() as { runner: { maxConcurrentIdle: number; traceAlways: boolean } }).runner).toMatchObject({ maxConcurrentIdle: 2, traceAlways: true });
    expect(h.settings.history('runner').length).toBeGreaterThanOrEqual(1);
  });

  it('client: tạo (token một lần, argon2id), danh sách không hash, thu hồi, verify', async () => {
    const created = await h.api({ method: 'POST', url: '/internal/clients', payload: { name: 'studioflow', scopes: ['jobs.read', 'jobs.write'], flowFilter: ['youtube/upload'] } });
    expect(created.statusCode).toBe(201);
    const { client, token } = created.json() as { client: { id: string; tokenPrefix: string }; token: string };
    expect(token).toMatch(/^pv_[A-Za-z0-9]{8}_[A-Za-z0-9_-]{43}$/);
    expect(token.slice(3, 11)).toBe(client.tokenPrefix);
    const list = await h.api({ method: 'GET', url: '/internal/clients' });
    expect(list.body).not.toContain('tokenHash');
    expect(list.body).not.toContain(token.slice(12));
    expect(JSON.stringify(h.audit.list())).not.toContain(token.slice(12));
    const repo = new ClientsRepo(h.t.database.db);
    expect(await verifyClientToken(repo, token)).toMatchObject({ id: client.id });
    expect(await verifyClientToken(repo, token.slice(0, -1) + 'x')).toBeUndefined();
    const revoked = await h.api({ method: 'POST', url: `/internal/clients/${client.id}/revoke` });
    expect((revoked.json() as { revokedAt: string | null }).revokedAt).not.toBeNull();
    expect(await verifyClientToken(repo, token)).toBeUndefined();
    expect((await h.api({ method: 'POST', url: '/internal/clients', payload: { name: '', scopes: [] } })).statusCode).toBe(400);
  });
});
