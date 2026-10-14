import { afterEach, describe, expect, it } from 'vitest';
import { SessionCheckInputSchema, SessionCheckOutputSchema } from '@sctech/profilevault-contract';
import { defineFlow } from '../src/flow.js';
import { Runner } from '../src/runner.js';
import { runnerHarness, waitFor } from './helpers.js';
import { chromium } from 'playwright';
import { createServer } from 'node:net';
let h: Awaited<ReturnType<typeof runnerHarness>> | undefined;
afterEach(async () => { await h?.cleanup(); h = undefined; });

describe('Runner queue và ownership', () => {
  it('FakeFury mở Chromium có CDP thật, Runner dùng context sẵn có và đóng profile', async () => {
    h = await runnerHarness(); const b = await h.binding();
    const probe = createServer(); await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const address = probe.address(); if (!address || typeof address === 'string') throw new Error('Không có port test');
    const port = address.port; await new Promise<void>((resolve) => probe.close(() => resolve()));
    let server: Awaited<ReturnType<typeof chromium.launchServer>> | undefined;
    h.fake.launchHandler = async () => { server = await chromium.launchServer({ headless: true, args: [`--remote-debugging-port=${port}`] }); return { cdpEndpoint: `http://127.0.0.1:${port}` }; };
    h.fake.stopHandler = async () => { await server?.close(); };
    const actual = new Runner({ ...h.deps, connect: undefined });
    try {
      const run = await actual.enqueue({ bindingId: b.id, flowId: 'test/check', idempotencyKey: 'cdp' });
      await actual.tick(); await waitFor(() => actual.getRun(run.id)?.status === 'done', 15_000);
      expect((await h.fury.getStatus('p1')).open).toBe(false); expect(actual.store.raw(run.id)!.launchedByRun).toBe(false);
    } finally { await actual.stop(); await server?.close(); }
  });
  it('reserve slot ngay khi launching và chỉ một run trên mỗi binding', async () => {
    h = await runnerHarness(); const a = await h.binding(1); const b = await h.binding(2);
    h.settings.set('runner', { maxConcurrentIdle: 1, maxConcurrentBusy: 1 }, 'user');
    let release: (() => void) | undefined;
    const connect = h.deps.connect;
    h.deps.connect = async () => { await new Promise<void>((resolve) => { release = resolve; }); return connect(); };
    const first = await h.runner.enqueue({ bindingId: a.id, flowId: 'test/check', idempotencyKey: 'first' });
    const same = await h.runner.enqueue({ bindingId: a.id, flowId: 'test/check', idempotencyKey: 'same-binding' });
    const other = await h.runner.enqueue({ bindingId: b.id, flowId: 'test/check', idempotencyKey: 'other-binding' });
    await h.runner.tick(); await waitFor(() => !!release);
    expect(h.runner.getRun(first.id)!.status).toBe('launching'); expect(h.runner.getRun(same.id)!.status).toBe('queued'); expect(h.runner.getRun(other.id)!.status).toBe('queued');
    release!(); await waitFor(() => h!.runner.getRun(first.id)?.status === 'done');
    h.deps.connect = connect;
  });
  it('L0 không launch; profile mở tay waiting_profile và chạy khi đã đóng', async () => {
    h = await runnerHarness(); const b = await h.binding(1, 0);
    const low = await h.runner.enqueue({ bindingId: b.id, flowId: 'test/check', idempotencyKey: 'low' });
    await h.runner.tick(); expect(h.runner.getRun(low.id)).toMatchObject({ status: 'cancelled', errorCode: 'LEVEL_TOO_LOW' });
    expect(h.fake.requests().some((r) => r.path === '/v1/profiles/start')).toBe(false);
    h.bundle.repos.bindings.setLevel(b.id, 1, h.clock.nowIso()); h.fake.setOpen('p1', true, 'app');
    const waiting = await h.runner.enqueue({ bindingId: b.id, flowId: 'test/check', idempotencyKey: 'busy' });
    await h.runner.tick(); expect(h.runner.getRun(waiting.id)!.status).toBe('waiting_profile');
    h.fake.setOpen('p1', false); h.clock.advance(60_000); await h.runner.tick();
    await waitFor(() => h!.runner.getRun(waiting.id)?.status === 'done');
    expect((await h.fury.getStatus('p1')).open).toBe(false);
    expect(h.runner.store.checkpoint(waiting.id).state.count).toBe(1);
  });
  it('enqueue idempotent, pause toàn cục và cleanup khi connect lỗi', async () => {
    h = await runnerHarness(); const b = await h.binding();
    const input = { bindingId: b.id, flowId: 'test/check', idempotencyKey: 'same' };
    const a = await h.runner.enqueue(input); expect((await h.runner.enqueue(input)).id).toBe(a.id);
    h.runner.setGlobalPause(true); await h.runner.tick(); expect(h.runner.getRun(a.id)!.status).toBe('queued');
    h.runner.setGlobalPause(false);
    h.deps.connect = async () => { throw new Error('connect failed'); };
    await h.runner.tick(); await waitFor(() => h!.runner.getRun(a.id)?.status === 'failed');
    expect((await h.fury.getStatus('p1')).open).toBe(false);
  });
  it('Fury ngoài khoảng chờ 60 giây, hết 30 phút failed; profile bận quá hạn failed', async () => {
    h = await runnerHarness(); const b = await h.binding();
    const run = await h.runner.enqueue({ bindingId: b.id, flowId: 'test/check', idempotencyKey: 'version' });
    h.fake.setVersion('9.0.0'); await h.runner.tick(); expect(h.runner.getRun(run.id)!.status).toBe('queued');
    h.clock.advance(30 * 60_000); await h.runner.tick(); expect(h.runner.getRun(run.id)).toMatchObject({ status: 'failed', errorCode: 'FURY_VERSION_UNSUPPORTED' });
  });
  it('CAPTCHA hủy queue của binding trước khi launch', async () => {
    h = await runnerHarness(); const b = await h.binding();
    const run = await h.runner.enqueue({ bindingId: b.id, flowId: 'test/check', idempotencyKey: 'captcha' });
    await h.bundle.health.recordManualEvent(b.id, 'manual.captcha');
    await waitFor(() => h!.runner.getRun(run.id)?.status === 'cancelled');
    expect(h.fake.requests().some((r) => r.path === '/v1/profiles/start')).toBe(false);
  });
});

describe('Gate và recovery', () => {
  it('timeout bước tạm ngưng khi gate đóng profile, rồi mở lại sau lựa chọn user', async () => {
    const flow = defineFlow({ id: 'test/gated-step', version: '1.0.0', description: 'Gate trong step', minLevel: 1, site: ['studio.youtube.com'], timeoutMinutes: 5 }, SessionCheckInputSchema, SessionCheckOutputSchema, async (ctx) => {
      await ctx.step('wait', () => ctx.humanGate({ reason: 'custom', message: 'Kiểm tra', choices: [{ id: 'continue', label: 'Tiếp' }], keepProfileOpen: false }), { timeoutSeconds: 0.05 });
      return { state: 'logged_in' };
    });
    h = await runnerHarness(flow); const b = await h.binding();
    const run = await h.runner.enqueue({ bindingId: b.id, flowId: 'test/gated-step', idempotencyKey: 'gated-step' });
    await h.runner.tick(); await waitFor(() => h!.runner.getRun(run.id)?.status === 'needs_user');
    await waitFor(() => !h!.runner.store.raw(run.id)!.launchedByRun);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(h.runner.getRun(run.id)!.status).toBe('needs_user');
    await h.runner.resolveGate(run.id, { choice: 'continue' }, 'user');
    await waitFor(() => h!.runner.getRun(run.id)?.status === 'done');
    expect(h.fake.requests().filter((r) => r.path === '/v1/profiles/start')).toHaveLength(2);
  });
  it.each([true, false])('retry chỉ khi bước idempotent=%s', async (idempotent) => {
    let attempts = 0;
    const flow = defineFlow({ id: 'test/retry', version: '1.0.0', description: 'Retry test', minLevel: 1, site: ['studio.youtube.com'], timeoutMinutes: 5 }, SessionCheckInputSchema, SessionCheckOutputSchema, async (ctx) => {
      await ctx.step('retry', async () => { if (++attempts === 1) throw new Error('temporary network failure'); }, { idempotent });
      return { state: 'logged_in' };
    });
    h = await runnerHarness(flow); const b = await h.binding();
    const run = await h.runner.enqueue({ bindingId: b.id, flowId: 'test/retry', idempotencyKey: 'retry' });
    await h.runner.tick(); await waitFor(() => ['done', 'failed'].includes(h!.runner.getRun(run.id)?.status ?? ''));
    expect(attempts).toBe(idempotent ? 2 : 1); expect(h.runner.getRun(run.id)!.status).toBe(idempotent ? 'done' : 'failed');
  });
  const gateFlow = (final: boolean) => defineFlow({ id: 'test/gate', version: '1.0.0', description: 'Gate test', minLevel: 1, site: ['studio.youtube.com'], timeoutMinutes: 5, modes: final ? ['L2', 'L3'] : [] }, SessionCheckInputSchema, SessionCheckOutputSchema, async (ctx) => {
    await ctx.step('first', async () => { ctx.state.first = Number(ctx.state.first ?? 0) + 1; });
    if (final) await ctx.step('final', async () => { ctx.state.finalRan = true; }, { final: true, idempotent: false });
    else await ctx.humanGate({ reason: 'custom', message: 'Kiểm tra', choices: [{ id: 'continue', label: 'Tiếp' }, { id: 'cancel', label: 'Hủy' }], keepProfileOpen: true });
    return { state: 'logged_in' };
  });
  it('L2 giữ profile chờ user, không chạy final và ghi l2Review', async () => {
    h = await runnerHarness(gateFlow(true)); const b = await h.binding(1, 2);
    const run = await h.runner.enqueue({ bindingId: b.id, flowId: 'test/gate', mode: 'L2', idempotencyKey: 'l2' });
    await h.runner.tick(); await waitFor(() => h!.runner.getRun(run.id)?.status === 'needs_user');
    expect((await h.fury.getStatus('p1')).open).toBe(true);
    await expect(h.runner.resolveGate(run.id, { choice: 'invalid' }, 'user')).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    await expect(h.runner.resolveGate(run.id, { choice: 'done_correct' }, 'client' as 'user')).rejects.toMatchObject({ code: 'FORBIDDEN_ACTION' });
    await h.runner.resolveGate(run.id, { choice: 'done_fixed' }, 'user');
    await waitFor(() => h!.runner.getRun(run.id)?.status === 'done');
    expect(h.runner.store.checkpoint(run.id).state.finalRan).toBeUndefined();
    expect(h.runner.listJobs({})[0]!.result).toMatchObject({ l2Review: 'fixed' });
  });
  it('gate timeout đóng profile và failed TIMEOUT', async () => {
    h = await runnerHarness(gateFlow(false)); const b = await h.binding();
    const run = await h.runner.enqueue({ bindingId: b.id, flowId: 'test/gate', idempotencyKey: 'timeout' });
    await h.runner.tick(); await waitFor(() => h!.runner.getRun(run.id)?.status === 'needs_user');
    h.clock.advance(25 * 3_600_000); await h.runner.tick();
    await waitFor(() => h!.runner.getRun(run.id)?.status === 'failed');
    expect(h.runner.getRun(run.id)!.errorCode).toBe('TIMEOUT'); expect((await h.fury.getStatus('p1')).open).toBe(false);
  });
  it('recovery bước idempotent replay từ checkpoint, bước không idempotent cần người', async () => {
    h = await runnerHarness(); const b = await h.binding();
    const run = await h.runner.enqueue({ bindingId: b.id, flowId: 'test/check', idempotencyKey: 'recover' });
    h.runner.store.patchRun(run.id, { status: 'running', launchedByRun: true }); h.fake.setOpen('p1', true, 'api');
    h.runner.store.saveCheckpoint(run.id, h.cp.parse({ activeStep: { index: 0, name: 'read', idempotent: true }, stepNames: ['read'] }));
    const restarted = new Runner(h.deps); await restarted.recover(); expect(restarted.getRun(run.id)).toMatchObject({ status: 'queued', attempt: 2 });
    await restarted.tick(); await waitFor(() => restarted.getRun(run.id)?.status === 'done'); await restarted.stop();
    const other = await h.runner.enqueue({ bindingId: b.id, flowId: 'test/check', idempotencyKey: 'recover-unsafe' });
    h.runner.store.patchRun(other.id, { status: 'running' });
    h.runner.store.saveCheckpoint(other.id, h.cp.parse({ activeStep: { index: 0, name: 'read', idempotent: false }, stepNames: ['read'] }));
    await h.runner.recover(); expect(h.runner.getRun(other.id)).toMatchObject({ status: 'needs_user', errorCode: 'INTERRUPTED' });
    await h.runner.resolveGate(other.id, { choice: 'resume' }, 'user'); await h.runner.tick();
    await waitFor(() => h!.runner.getRun(other.id)?.status === 'done');
    expect(h.runner.store.checkpoint(other.id).state.count).toBeUndefined();
  });
});
