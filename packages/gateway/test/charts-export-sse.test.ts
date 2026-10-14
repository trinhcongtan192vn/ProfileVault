import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freePort, makeGateway, type GwHarness } from './helpers.js';

let h: GwHarness;
let bindingId: string;
beforeEach(async () => {
  h = await makeGateway({ port: await freePort() });
  h.fake.upsertProfile({ id: 'p1', name: 'Kênh 1', personaId: 'persona-1', os: 'windows' });
  const res = await h.api({ method: 'POST', url: '/internal/bindings', payload: { platform: 'youtube', accountId: 'UC1', displayName: 'Kênh 1', furyProfileId: 'p1', marketCountry: 'DE' } });
  bindingId = (res.json() as { id: string }).id;
});
afterEach(() => h.cleanup());

describe('biểu đồ (SPEC-07 §8) và xuất CSV', () => {
  it('7 biểu đồ trả đúng dạng; tên lạ → 400', async () => {
    for (let i = 0; i < 3; i++) {
      await h.bundle.health.recordManualEvent(bindingId, 'manual.upload');
      h.clock.advance(86_400_000);
    }
    await h.bundle.health.recordRunOutcome({ bindingId, runId: 'rn_01JAAAAAAAAAAAAAAAAAAAAAAA', flowId: 'youtube/upload', mode: 'L2', status: 'done', l2Review: 'correct' });
    await h.bundle.health.recordRunOutcome({ bindingId, runId: 'rn_01JAAAAAAAAAAAAAAAAAAAAAAB', flowId: 'youtube/upload', mode: 'L2', status: 'needs_user', step: 'review_before_final' });
    await h.bundle.health.recordSessionCheck(bindingId, { state: 'logged_in' });
    await h.bundle.health.recordSessionCheck(bindingId, { state: 'failed', error: 'x' });
    h.fake.setExit('p1', { ip: '1.1.1.1', country: 'DE', asn: 1, asnType: 'isp' });
    await h.bundle.health.runProxyCheckNow(bindingId);
    h.clock.advance(3_600_000);
    h.fake.setExit('p1', { ip: '1.1.1.1', country: 'DE', asn: 1, asnType: 'isp' });
    await h.bundle.health.runProxyCheckNow(bindingId);
    await h.bundle.health.recordDetectSuite({ furyVersion: '0.2.23', passed: true }, 'user');
    await h.login(); // đồng hồ đã tiến > 12 giờ → phiên cũ hết hạn

    const get = async (name: string, extra = '') => {
      const r = await h.api({ method: 'GET', url: `/internal/charts/${name}?bindingId=${bindingId}${extra}` });
      if (r.statusCode !== 200) throw new Error(`${name}: ${r.statusCode} ${r.body}`);
      return r.json() as { name: string; kind: string; points?: { bucket: string; series: Record<string, number> }[]; spans?: { label: string; from: string; to: string }[] };
    };
    const uploads = await get('uploads_by_mode');
    expect(uploads.kind).toBe('series');
    expect(uploads.points!.reduce((n, p) => n + (p.series.manual ?? 0), 0)).toBe(3);
    expect(uploads.points!.reduce((n, p) => n + (p.series.L2 ?? 0), 0)).toBe(1);
    const weekly = await get('uploads_by_mode', '&bucket=week');
    expect(weekly.points!.length).toBeLessThanOrEqual(uploads.points!.length);
    const rates = await get('success_rates');
    expect(rates.points!.at(-1)?.series.session_check).toBe(0.5);
    const needs = await get('needs_user_by_reason');
    expect(needs.points!.at(-1)?.series.review_before_final).toBe(1);
    const age = await get('session_age');
    expect(age.points!.length).toBeGreaterThan(0);
    const exit = await get('exit_timeline');
    expect(exit.kind).toBe('spans');
    expect(exit.spans).toHaveLength(1);
    expect(exit.spans![0]).toMatchObject({ label: 'DE/AS1' });
    const detect = await get('detect_suite_timeline');
    expect(detect.spans![0]).toMatchObject({ label: '0.2.23', ok: true });
    const score = await get('consistency_score');
    expect(score.points!.length).toBeGreaterThan(0);
    expect((await h.api({ method: 'GET', url: '/internal/charts/nope' })).statusCode).toBe(400);
  });

  it('CSV: số dòng khớp CSDL, BOM, escape; dataset lạ → 400', async () => {
    await h.bundle.health.recordManualEvent(bindingId, 'manual.note', undefined, 'có "ngoặc", dấu phẩy\nvà xuống dòng');
    const res = await h.api({ method: 'GET', url: `/internal/export/events.csv?bindingId=${bindingId}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('events-');
    expect(res.body.startsWith('﻿')).toBe(true);
    const dbCount = h.bundle.health.listEvents(bindingId, { limit: 10_000 }).length;
    const lines = res.body.slice(1).trimEnd().split('\r\n');
    expect(lines).toHaveLength(dbCount + 1); // header
    // payload_json là JSON (dấu " → \" và xuống dòng → \n), rồi CSV bọc và nhân đôi dấu "
    expect(res.body).toContain('"{""note"":""có \\""ngoặc\\"", dấu phẩy\\nvà xuống dòng""}"');
    for (const ds of ['proxy_checks', 'runs', 'level_changes', 'consistency_results']) {
      expect((await h.api({ method: 'GET', url: `/internal/export/${ds}.csv` })).statusCode).toBe(200);
    }
    expect((await h.api({ method: 'GET', url: '/internal/export/nope.csv' })).statusCode).toBe(400);
    expect((await h.api({ method: 'GET', url: '/internal/export/events.json' })).statusCode).toBe(404);
  });
});

describe('SSE (SPEC-05 §3)', () => {
  it('đẩy sự kiện bus dạng event/data, heartbeat qua timer tiêm; đóng → hủy đăng ký', async () => {
    const url = await h.gw.listen();
    const { cookie } = await h.login();
    const ac = new AbortController();
    const res = await fetch(`${url}/internal/stream`, { headers: { cookie }, signal: ac.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const readUntil = async (needle: string) => {
      for (let i = 0; i < 50 && !buf.includes(needle); i++) {
        const { value, done } = (await reader.read()) as { value?: Uint8Array; done: boolean };
        if (done) break;
        buf += decoder.decode(value);
      }
      return buf.includes(needle);
    };
    expect(await readUntil('retry: 3000')).toBe(true);
    expect(h.gw.sseConnections()).toBe(1);
    await h.bundle.health.recordManualEvent(bindingId, 'manual.upload');
    expect(await readUntil('event: health.event_recorded')).toBe(true);
    expect(buf).toContain('"type":"manual.upload"');
    h.timers.fire(15_000);
    expect(await readUntil(': heartbeat')).toBe(true);
    ac.abort();
    await new Promise((r) => setTimeout(r, 100));
    expect(h.gw.sseConnections()).toBe(0);
  });
});
