import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeRunner, makeGateway, type GwHarness } from './helpers.js';

let h: GwHarness;
let runner: FakeRunner;
beforeEach(async () => {
  runner = new FakeRunner();
  h = await makeGateway({ runner });
  h.fake.upsertProfile({ id: 'p1', name: 'Kênh 1', personaId: 'persona-1', os: 'windows' });
});
afterEach(() => h.cleanup());

async function binding() {
  const r = await h.api({ method: 'POST', url: '/internal/bindings', payload: { platform: 'youtube', accountId: 'UC1', displayName: 'Kênh 1', furyProfileId: 'p1', marketCountry: 'DE' } });
  return (r.json() as { id: string }).id;
}

describe('endpoint tổng hợp dashboard (spec 006)', () => {
  it('overview: một dòng/binding với readiness, pause, cờ đỏ, điểm, exit, Fury', async () => {
    const id = await binding();
    h.fake.setExit('p1', { ip: '1.2.3.4', country: 'DE', asn: 3320, asnType: 'unknown' });
    await h.api({ method: 'POST', url: `/internal/bindings/${id}/proxy-check` });
    await h.api({ method: 'POST', url: `/internal/bindings/${id}/events`, payload: { type: 'manual.captcha' } });
    const o = (await h.api({ method: 'GET', url: '/internal/overview' })).json() as { rows: { readiness: { nextLevel: number; missing: string[] }; openPauses: { reason: string }[]; lastRed: { type: string }; consistency: { total: number }; exit: { country: string }; fury: { version: string } }[]; timezone: string };
    expect(o.timezone).toBe('Asia/Bangkok');
    expect(o.rows).toHaveLength(1);
    const row = o.rows[0]!;
    expect(row.readiness.nextLevel).toBe(1);
    expect(row.readiness.missing).toContain('days_at_level');
    expect(row.openPauses.map((p) => p.reason)).toContain('red_event');
    expect(row.lastRed.type).toBe('manual.captcha');
    expect(row.consistency.total).toBe(21);
    expect(row.exit.country).toBe('DE');
    expect(row.fury.version).toBe('0.2.23');
  });

  it('inbox: run needs_user, dừng chờ gỡ, ASN chưa phân loại, Fury chưa detect-suite', async () => {
    const id = await binding();
    h.fake.setExit('p1', { ip: '1.2.3.4', country: 'DE', asn: 64512, asnType: 'unknown' });
    await h.api({ method: 'POST', url: `/internal/bindings/${id}/proxy-check` });
    await h.api({ method: 'POST', url: `/internal/bindings/${id}/pause`, payload: {} });
    runner.runs.set('rn_01JAAAAAAAAAAAAAAAAAAAAAAA', { id: 'rn_01JAAAAAAAAAAAAAAAAAAAAAAA', jobId: 'jb_01JAAAAAAAAAAAAAAAAAAAAAAA', bindingId: id, flowId: 'youtube/upload', flowVersion: '1', status: 'needs_user', currentStep: 'review_before_final', attempt: 1, needsUser: { reason: 'review_before_final', message: 'Mời kiểm tra', choices: [{ id: 'done_correct', label: 'Đúng hết' }], keepProfileOpen: true, since: '2026-10-14T03:00:00.000Z' }, queuedAt: '2026-10-14T02:00:00.000Z', startedAt: null, finishedAt: null, errorCode: null, errorDetail: null, artifactsDir: null, steps: [] });
    const items = ((await h.api({ method: 'GET', url: '/internal/inbox' })).json() as { items: { kind: string }[] }).items.map((i) => i.kind);
    expect(items).toEqual(expect.arrayContaining(['run', 'pause', 'asn_unclassified', 'fury_no_detect_suite']));
    await h.api({ method: 'POST', url: '/internal/detect-suite', payload: { furyVersion: '0.2.23', passed: true } });
    await h.api({ method: 'POST', url: '/internal/asn-attestations', payload: { asn: 64512, asnType: 'isp' } });
    const after = ((await h.api({ method: 'GET', url: '/internal/inbox' })).json() as { items: { kind: string }[] }).items.map((i) => i.kind);
    expect(after).not.toContain('fury_no_detect_suite');
    expect(after).not.toContain('asn_unclassified');
  });

  it('hoàn tác upload: ghi manual.note undoOf; event_count không tính; quá 10 phút/đỏ/hai lần → 400', async () => {
    const id = await binding();
    const ev = (await h.api({ method: 'POST', url: `/internal/bindings/${id}/events`, payload: { type: 'manual.upload' } })).json() as { id: string };
    const undo = await h.api({ method: 'POST', url: `/internal/bindings/${id}/events/${ev.id}/undo` });
    expect(undo.statusCode).toBe(201);
    expect(undo.json()).toMatchObject({ type: 'manual.note', payload: { undoOf: ev.id } });
    const r = (await h.api({ method: 'GET', url: `/internal/bindings/${id}/readiness?fresh=true` })).json() as { conditions: { condition: { kind: string }; current: number }[] };
    expect(r.conditions.find((c) => c.condition.kind === 'event_count')?.current).toBe(0);
    expect((await h.api({ method: 'POST', url: `/internal/bindings/${id}/events/${ev.id}/undo` })).statusCode).toBe(400);
    const red = (await h.api({ method: 'POST', url: `/internal/bindings/${id}/events`, payload: { type: 'manual.captcha' } })).json() as { id: string };
    expect((await h.api({ method: 'POST', url: `/internal/bindings/${id}/events/${red.id}/undo` })).statusCode).toBe(400);
    const ev2 = (await h.api({ method: 'POST', url: `/internal/bindings/${id}/events`, payload: { type: 'manual.upload' } })).json() as { id: string };
    h.clock.advance(11 * 60_000);
    expect((await h.api({ method: 'POST', url: `/internal/bindings/${id}/events/${ev2.id}/undo` })).statusCode).toBe(400);
  });

  it('/auth/open?next= chỉ chuyển hướng đường dẫn nội bộ', async () => {
    const host = { host: `127.0.0.1:${h.port}` };
    const ok = new URL(h.gw.createOpenUrl('/inbox'));
    expect((await h.gw.app.inject({ method: 'GET', url: ok.pathname + ok.search, headers: host })).headers.location).toBe('/inbox');
    const evil = new URL(h.gw.createOpenUrl('//evil.com'));
    expect((await h.gw.app.inject({ method: 'GET', url: evil.pathname + evil.search, headers: host })).headers.location).toBe('/');
  });
});
