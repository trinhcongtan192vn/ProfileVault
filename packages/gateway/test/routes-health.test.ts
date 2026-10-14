import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeGateway, type GwHarness } from './helpers.js';

const probeFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'health', 'test', 'probes', 'base.json');

let h: GwHarness;
beforeEach(async () => {
  h = await makeGateway();
  h.fake.upsertProfile({ id: 'p1', name: 'Kênh 1', personaId: 'persona-1', os: 'windows' });
  h.fake.upsertProfile({ id: 'p2', name: 'Kênh 2' });
});
afterEach(() => h.cleanup());

async function createBinding(n = 1) {
  const res = await h.api({ method: 'POST', url: '/internal/bindings', payload: { platform: 'youtube', accountId: `UC${n}`, displayName: `Kênh ${n}`, furyProfileId: `p${n}`, marketCountry: 'DE' } });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string };
}

describe('/internal Fury + binding + mức + dừng (SPEC-05 §7)', () => {
  it('fury: trạng thái, token, profiles kèm bound', async () => {
    let fury = (await h.api({ method: 'GET', url: '/internal/fury' })).json() as { health: { reachable: boolean }; hasToken: boolean; currentVersion: string };
    expect(fury.health.reachable).toBe(true);
    expect(fury.hasToken).toBe(false);
    expect(fury.currentVersion).toBe('0.2.23');
    const put = await h.api({ method: 'PUT', url: '/internal/fury/token', payload: { token: 'super-secret-fury-token' } });
    expect(put.statusCode).toBe(204);
    expect(await h.secrets.get('fury.token')).toBe('super-secret-fury-token');
    expect(JSON.stringify(h.audit.list())).not.toContain('super-secret-fury-token');
    fury = (await h.api({ method: 'GET', url: '/internal/fury' })).json() as typeof fury;
    expect(fury.hasToken).toBe(true);
    await createBinding(1);
    const profiles = (await h.api({ method: 'GET', url: '/internal/fury/profiles' })).json() as { profiles: { id: string; bound: boolean }[] };
    expect(profiles.profiles.find((p) => p.id === 'p1')?.bound).toBe(true);
    expect(profiles.profiles.find((p) => p.id === 'p2')?.bound).toBe(false);
  });

  it('binding CRUD + lỗi schema/trùng/404', async () => {
    const b = await createBinding(1);
    const bad = await h.api({ method: 'POST', url: '/internal/bindings', payload: { platform: 'youtube' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: { code: 'INPUT_INVALID', detail: { issues: expect.any(Array) } } });
    const dup = await h.api({ method: 'POST', url: '/internal/bindings', payload: { platform: 'youtube', accountId: 'UC9', displayName: 'x', furyProfileId: 'p1', marketCountry: 'DE' } });
    expect(dup.statusCode).toBe(400);
    const list = (await h.api({ method: 'GET', url: '/internal/bindings' })).json() as { bindings: unknown[] };
    expect(list.bindings).toHaveLength(1);
    const got = await h.api({ method: 'GET', url: `/internal/bindings/${b.id}` });
    expect(got.statusCode).toBe(200);
    const patched = await h.api({ method: 'PATCH', url: `/internal/bindings/${b.id}`, payload: { displayName: 'Đổi tên', allowedRoots: ['E:\\v'] } });
    expect(patched.json()).toMatchObject({ displayName: 'Đổi tên', allowedRoots: ['E:\\v'] });
    const missing = await h.api({ method: 'GET', url: '/internal/bindings/ab_01JAAAAAAAAAAAAAAAAAAAAAAA' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: 'ACCOUNT_NOT_BOUND' } });
    const badId = await h.api({ method: 'GET', url: '/internal/bindings/not-an-id' });
    expect(badId.statusCode).toBe(400);
    const del = await h.api({ method: 'DELETE', url: `/internal/bindings/${b.id}` });
    expect(del.statusCode).toBe(204);
    expect(((await h.api({ method: 'GET', url: '/internal/bindings' })).json() as { bindings: unknown[] }).bindings).toHaveLength(0);
  });

  it('sự kiện, readiness, promote (lỗi 400/422), pause/clear', async () => {
    const b = await createBinding(1);
    const ev = await h.api({ method: 'POST', url: `/internal/bindings/${b.id}/events`, payload: { type: 'manual.upload', note: 'video 1' } });
    expect(ev.statusCode).toBe(201);
    expect(ev.json()).toMatchObject({ type: 'manual.upload', payload: { note: 'video 1' } });
    const list = (await h.api({ method: 'GET', url: `/internal/bindings/${b.id}/events?types=manual.upload,manual.note&limit=10` })).json() as { events: unknown[] };
    expect(list.events).toHaveLength(1);
    const readiness = (await h.api({ method: 'GET', url: `/internal/bindings/${b.id}/readiness` })).json() as { canPromote: boolean; conditions: unknown[] };
    expect(readiness.canPromote).toBe(false);
    expect(readiness.conditions).toHaveLength(7);
    const promote = await h.api({ method: 'POST', url: `/internal/bindings/${b.id}/promote` });
    expect([400, 422]).toContain(promote.statusCode);
    const pause = await h.api({ method: 'POST', url: `/internal/bindings/${b.id}/pause`, payload: { note: 'bảo trì' } });
    expect(pause.statusCode).toBe(201);
    const pauseId = (pause.json() as { id: string }).id;
    const pauses = (await h.api({ method: 'GET', url: `/internal/bindings/${b.id}/pauses?open=true` })).json() as { pauses: { reason: string }[] };
    expect(pauses.pauses.map((p) => p.reason)).toContain('manual');
    expect((await h.api({ method: 'POST', url: `/internal/pauses/${pauseId}/clear` })).statusCode).toBe(204);
    const sys = pauses.pauses.find((p) => p.reason === 'consistency_block') as { id: string } | undefined;
    if (sys) {
      const forbidden = await h.api({ method: 'POST', url: `/internal/pauses/${sys.id}/clear` });
      expect(forbidden.statusCode).toBe(403);
      expect(forbidden.json()).toMatchObject({ error: { code: 'FORBIDDEN_ACTION' } });
    }
    const red = await h.api({ method: 'POST', url: `/internal/bindings/${b.id}/events`, payload: { type: 'manual.captcha' } });
    expect(red.statusCode).toBe(201);
    expect((await h.api({ method: 'GET', url: `/internal/bindings/${b.id}/level-changes` })).json()).toMatchObject({ levelChanges: [] }); // L0 giữ L0
    expect(((await h.api({ method: 'GET', url: `/internal/bindings/${b.id}/pauses?open=true` })).json() as { pauses: { reason: string }[] }).pauses.map((p) => p.reason)).toContain('red_event');
  });
});

describe('/internal probe, checklist, nhất quán, detect-suite, ASN', () => {
  it('probe JSON + multipart, danh sách + so sánh; thiếu trường → 400 missing', async () => {
    const b = await createBinding(1);
    const raw = JSON.parse(readFileSync(probeFile, 'utf8')) as Record<string, unknown>;
    const json = await h.api({ method: 'POST', url: `/internal/bindings/${b.id}/probes`, payload: { raw } });
    expect(json.statusCode).toBe(201);
    expect(json.json()).toMatchObject({ furyVersion: '0.2.23', source: 'manual_import' });
    const boundary = '----pvtest';
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="probe.json"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(raw)}\r\n--${boundary}--\r\n`;
    h.clock.advance(1000);
    const mp = await h.api({ method: 'POST', url: `/internal/bindings/${b.id}/probes`, payload: body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } });
    expect(mp.statusCode).toBe(201);
    const list = (await h.api({ method: 'GET', url: `/internal/bindings/${b.id}/probes` })).json() as { probes: unknown[]; comparison: { changes: unknown[] } | null };
    expect(list.probes).toHaveLength(2);
    expect(list.comparison?.changes).toEqual([]);
    const { timezone: _tz, ...missing } = raw;
    const bad = await h.api({ method: 'POST', url: `/internal/bindings/${b.id}/probes`, payload: { raw: missing } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: { code: 'INPUT_INVALID', detail: { missing: ['timezone'] } } });
  });

  it('checklist GET/PUT/confirm không lộ giá trị gốc; nhất quán run/get/matrix; detect-suite; ASN', async () => {
    const b = await createBinding(1);
    const put = await h.api({ method: 'PUT', url: `/internal/bindings/${b.id}/checklist`, payload: { accountRegion: 'DE', channelCountry: 'DE', accountLanguage: 'de', recoveryEmail: 'me@example.com', recoveryPhone: '+491512345678', twofaEnabled: true, exclusiveLoginConfirmed: true, studioLanguageSet: true } });
    expect(put.statusCode).toBe(200);
    expect(put.body).not.toContain('example.com');
    expect(put.json()).toMatchObject({ hasRecoveryEmail: true, complete: true });
    const confirm = await h.api({ method: 'POST', url: `/internal/bindings/${b.id}/checklist/confirm` });
    expect(confirm.statusCode).toBe(200);
    expect((confirm.json() as { expired: boolean }).expired).toBe(false);
    const get = await h.api({ method: 'GET', url: `/internal/bindings/${b.id}/checklist` });
    expect(get.body).not.toContain('example.com');

    const run = await h.api({ method: 'POST', url: '/internal/consistency/run', payload: { bindingId: b.id } });
    expect(run.statusCode).toBe(200);
    expect((run.json() as { bindings: { results: unknown[] }[] }).bindings[0]?.results).toHaveLength(22);
    const latest = (await h.api({ method: 'GET', url: `/internal/bindings/${b.id}/consistency` })).json() as { trigger: string; score: { total: number } };
    expect(latest.trigger).toBe('manual');
    expect(latest.score.total).toBe(21);
    const matrix = await h.api({ method: 'GET', url: '/internal/consistency/matrix' });
    expect(matrix.json()).toMatchObject({ bindingIds: [b.id], cells: [] });

    expect((await h.api({ method: 'POST', url: '/internal/detect-suite', payload: { furyVersion: '0.2.23', passed: true, summary: 'ok' } })).statusCode).toBe(204);
    expect((await h.api({ method: 'POST', url: '/internal/asn-attestations', payload: { asn: 3320, asnType: 'isp' } })).statusCode).toBe(204);
    expect((await h.api({ method: 'GET', url: '/internal/asn-attestations' })).json()).toMatchObject({ attestations: [{ asn: 3320, asnType: 'isp' }] });
    expect((await h.api({ method: 'POST', url: '/internal/asn-attestations', payload: { asn: 1, asnType: 'unknown' } })).statusCode).toBe(400);
    const host = await h.api({ method: 'POST', url: '/internal/host/capture' });
    expect(host.json()).toMatchObject({ os: 'windows' });
  });

  it('proxy-check ngay và danh sách', async () => {
    const b = await createBinding(1);
    h.fake.setExit('p1', { ip: '1.2.3.4', country: 'DE', asn: 3320, asnType: 'isp' });
    const res = await h.api({ method: 'POST', url: `/internal/bindings/${b.id}/proxy-check` });
    expect(res.json()).toMatchObject({ ok: true, exitIp: '1.2.3.4' });
    expect(((await h.api({ method: 'GET', url: `/internal/bindings/${b.id}/proxy-checks` })).json() as { proxyChecks: unknown[] }).proxyChecks).toHaveLength(1);
  });
});
