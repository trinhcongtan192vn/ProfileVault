import { describe, expect, it } from 'vitest';
import { newId, type Binding, type FuryProfileDetail, type HostSnapshot, type ProbeResult, type ProxyCheck, type RuleOutcome } from '@sctech/profilevault-contract';
import type { ChecklistRow } from '@sctech/profilevault-db';
import { ALL_RULES, RULES_BY_ID, loadRuleData, parseFuryCapture, type BindingSnapshot, type RuleContext } from '../src/index.js';
import { fixture } from './probe.test.js';

const NOW = new Date('2026-10-14T10:00:00.000Z');

function binding(n = 1, extra: Partial<Binding> = {}): Binding {
  return {
    id: newId('binding'),
    platform: 'youtube',
    accountId: `UC${n}`,
    displayName: `Kênh ${n}`,
    furyProfileId: `p${n}`,
    marketCountry: 'DE',
    packConfig: { studioLanguage: 'en', _personaAtBind: 'persona-win-1' },
    allowedRoots: [],
    level: 0,
    levelSince: '2026-10-01T00:00:00.000Z',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    archivedAt: null,
    ...extra,
  };
}
function exit(b: Binding, extra: Partial<ProxyCheck> = {}): ProxyCheck {
  return { id: newId('proxyCheck'), bindingId: b.id, ok: true, exitIp: '5.6.7.8', country: 'DE', city: 'Frankfurt', timezone: 'Europe/Berlin', asn: 3320, asnOrg: 'DTAG', asnType: 'isp', latencyMs: 100, error: null, checkedAt: '2026-10-14T09:00:00.000Z', ...extra };
}
function probe(b: Binding, name = 'base', extra: Partial<ProbeResult> = {}): ProbeResult {
  const data = parseFuryCapture(fixture(name)).probe;
  return { id: newId('probe'), bindingId: b.id, furyVersion: data.furyVersion, source: 'manual_import', capturedAt: data.capturedAt, data, rawPath: '', createdAt: data.capturedAt, ...extra };
}
function fury(extra: Partial<FuryProfileDetail> = {}): FuryProfileDetail {
  return { id: 'p1', name: 'A', tags: [], personaId: 'persona-win-1', osFamily: 'windows', timezone: 'Europe/Berlin', languages: ['de-DE'], geolocation: { mode: 'off' }, seed: 'seed-1', ...extra };
}
function checklist(b: Binding, extra: Partial<ChecklistRow> = {}): ChecklistRow {
  return { bindingId: b.id, accountRegion: 'DE', channelCountry: 'DE', accountLanguage: 'de-DE', recoveryEmailHmac: 'h-email-1', recoveryPhoneHmac: 'h-phone-1', twofaEnabled: true, exclusiveLoginConfirmed: true, studioLanguageSet: true, confirmedAt: '2026-10-01T00:00:00.000Z', expiresAt: '2026-12-30T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...extra };
}
const host: HostSnapshot = { os: 'windows', osVersion: '10.0.19045', gpus: [{ name: 'NVIDIA GeForce RTX 5060 Ti' }], displays: [{ width: 2560, height: 1440, primary: true }], ramMb: 32768, capturedAt: '2026-10-14T00:00:00.000Z' };

function ctxOf(b: Binding, parts: Partial<RuleContext> = {}): RuleContext {
  return { binding: b, allBindings: parts.allBindings ?? [{ binding: b, exit: parts.exit, furyProfile: parts.furyProfile, checklist: parts.checklist, probe: parts.probe }], attestations: new Map(), now: NOW, data: loadRuleData(), host, ...parts };
}
function run(id: string, ctx: RuleContext, params?: Record<string, unknown>): RuleOutcome {
  const rule = RULES_BY_ID.get(id as never)!;
  const r = rule.evaluate(ctx, params ?? rule.defaultParams);
  return Array.isArray(r) ? r.find((o) => o.bindingId === ctx.binding.id)! : r;
}
function cross(id: string, snaps: BindingSnapshot[], params?: Record<string, unknown>): RuleOutcome[] {
  const rule = RULES_BY_ID.get(id as never)!;
  return rule.evaluate(ctxOf(snaps[0]!.binding, { allBindings: snaps }), params ?? rule.defaultParams) as RuleOutcome[];
}

describe('22 luật nhất quán (SPEC-02 §6.4)', () => {
  it('danh mục đủ 22 luật, mỗi luật có title', () => {
    expect(ALL_RULES).toHaveLength(22);
    expect(ALL_RULES.every((r) => r.title.length > 0)).toBe(true);
  });

  it('A1 quốc gia exit = thị trường', () => {
    const b = binding();
    expect(run('A1.exit_country_matches_market', ctxOf(b, { exit: exit(b) })).status).toBe('pass');
    const f = run('A1.exit_country_matches_market', ctxOf(b, { exit: exit(b, { country: 'FR' }) }));
    expect(f.status).toBe('fail');
    expect(f.hint).toContain('FR');
    expect(run('A1.exit_country_matches_market', ctxOf(b)).status).toBe('unknown');
  });

  it('A2 múi giờ khớp exit: probe lệch → fail với gợi ý Europe/Berlin; auto → pass; thiếu → unknown', () => {
    const b = binding();
    expect(run('A2.timezone_matches_exit', ctxOf(b, { exit: exit(b), probe: probe(b) })).status).toBe('pass');
    const f = run('A2.timezone_matches_exit', ctxOf(b, { exit: exit(b), probe: probe(b, 'timezone-off') }));
    expect(f.status).toBe('fail');
    expect(f.actual).toBe('Asia/Bangkok');
    expect(f.hint).toContain('Europe/Berlin');
    expect(run('A2.timezone_matches_exit', ctxOf(b, { exit: exit(b), furyProfile: fury({ timezone: 'auto' }) })).status).toBe('pass');
    expect(run('A2.timezone_matches_exit', ctxOf(b, { exit: exit(b), furyProfile: fury({ timezone: 'Europe/Paris' }) })).status).toBe('fail'); // cùng offset, khác nước
    expect(run('A2.timezone_matches_exit', ctxOf(b, { exit: exit(b) })).status).toBe('unknown');
  });

  it('A3 ngôn ngữ hợp lý (warn)', () => {
    const b = binding();
    expect(run('A3.language_plausible', ctxOf(b, { exit: exit(b), probe: probe(b) })).status).toBe('pass');
    expect(run('A3.language_plausible', ctxOf(b, { exit: exit(b, { country: 'JP' }), probe: probe(b) })).status).toBe('fail');
    expect(run('A3.language_plausible', ctxOf(b, { exit: exit(b, { country: 'JP' }), furyProfile: fury({ languages: ['en-US'] }) })).status).toBe('pass');
    expect(run('A3.language_plausible', ctxOf(b, { exit: exit(b, { country: 'ZZ' }), probe: probe(b) })).status).toBe('unknown');
  });

  it('A4 geolocation: off/auto pass; manual gần → pass, xa → fail, thiếu tọa độ thành phố → unknown', () => {
    const b = binding();
    expect(run('A4.geolocation_off_or_matches', ctxOf(b, { exit: exit(b), furyProfile: fury() })).status).toBe('pass');
    expect(run('A4.geolocation_off_or_matches', ctxOf(b, { exit: exit(b), furyProfile: fury({ geolocation: { mode: 'manual', lat: 50.11, lon: 8.68 } }) })).status).toBe('pass');
    const far = run('A4.geolocation_off_or_matches', ctxOf(b, { exit: exit(b), furyProfile: fury({ geolocation: { mode: 'manual', lat: 13.75, lon: 100.5 } }) }));
    expect(far.status).toBe('fail');
    expect(far.hint).toMatch(/km/);
    expect(run('A4.geolocation_off_or_matches', ctxOf(b, { exit: exit(b, { city: 'Nowhere' }), furyProfile: fury({ geolocation: { mode: 'manual', lat: 1, lon: 1 } }) })).status).toBe('unknown');
    expect(run('A4.geolocation_off_or_matches', ctxOf(b, { exit: exit(b) })).status).toBe('unknown');
  });

  it('A5 ASN: isp pass; hosting fail; mobile fail-warn; unknown → unknown; attestation → pass', () => {
    const b = binding();
    expect(run('A5.asn_residential', ctxOf(b, { exit: exit(b) })).status).toBe('pass');
    expect(run('A5.asn_residential', ctxOf(b, { exit: exit(b, { asnType: 'hosting' }) })).status).toBe('fail');
    const m = run('A5.asn_residential', ctxOf(b, { exit: exit(b, { asnType: 'mobile' }) }));
    expect(m).toMatchObject({ status: 'fail', severityOverride: 'warn' });
    const u = run('A5.asn_residential', ctxOf(b, { exit: exit(b, { asnType: 'unknown' }) }));
    expect(u.status).toBe('unknown');
    expect(u.hint).toContain('xác nhận');
    const ctx = ctxOf(b, { exit: exit(b, { asnType: 'unknown' }) });
    ctx.attestations.set(3320, 'residential');
    expect(run('A5.asn_residential', ctx)).toMatchObject({ status: 'pass', actual: { source: 'attestation' } });
  });

  it('A6 rò WebRTC/DNS: IP nội bộ không tính; IP công cộng khác exit → fail; DNS khác nước → fail', () => {
    const b = binding();
    expect(run('A6.no_leaks', ctxOf(b, { exit: exit(b), probe: probe(b) })).status).toBe('pass');
    const f = run('A6.no_leaks', ctxOf(b, { exit: exit(b), probe: probe(b, 'webrtc-leak') }));
    expect(f.status).toBe('fail');
    expect(f.hint).toContain('9.9.9.9');
    expect(run('A6.no_leaks', ctxOf(b, { exit: exit(b, { country: 'FR' }), probe: probe(b) })).hint).toContain('DNS');
    expect(run('A6.no_leaks', ctxOf(b, { exit: exit(b) })).status).toBe('unknown');
  });

  it('B1–B4 máy chạy', () => {
    const b = binding();
    expect(run('B1.os_matches_host', ctxOf(b, { probe: probe(b) })).status).toBe('pass');
    expect(run('B1.os_matches_host', ctxOf(b, { furyProfile: fury({ osFamily: 'macos' }) })).status).toBe('fail');
    expect(run('B1.os_matches_host', ctxOf(b)).status).toBe('unknown');
    expect(run('B2.gpu_class_plausible', ctxOf(b, { probe: probe(b) }))).toMatchObject({ status: 'pass', actual: { personaTier: 3, hostTier: 4 } });
    expect(run('B2.gpu_class_plausible', ctxOf(b, { probe: probe(b, 'upgraded-gpu-changed') })).status).toBe('fail'); // UHD 630 hạng 1 vs 4
    expect(run('B2.gpu_class_plausible', ctxOf(b, { probe: probe(b), host: { ...host, gpus: [] } })).status).toBe('unknown');
    expect(run('B3.screen_fits_host', ctxOf(b, { probe: probe(b) })).status).toBe('pass');
    expect(run('B3.screen_fits_host', ctxOf(b, { probe: probe(b), host: { ...host, displays: [{ width: 1366, height: 768 }] } })).status).toBe('fail');
    expect(run('B3.screen_fits_host', ctxOf(b, { probe: probe(b), host: { ...host, displays: [] } })).status).toBe('unknown');
    expect(run('B4.voices_fonts_os', ctxOf(b, { probe: probe(b) })).status).toBe('pass');
    const v = run('B4.voices_fonts_os', ctxOf(b, { probe: probe(b, 'voices-macos') }));
    expect(v.status).toBe('fail');
    expect(v.hint).toContain('macos');
  });

  it('C1–C3 tài khoản', () => {
    const b = binding();
    expect(run('C1.account_geo_aligned', ctxOf(b, { exit: exit(b), checklist: checklist(b) })).status).toBe('pass');
    expect(run('C1.account_geo_aligned', ctxOf(b, { exit: exit(b), checklist: checklist(b, { channelCountry: 'US' }) })).status).toBe('fail');
    expect(run('C1.account_geo_aligned', ctxOf(b, { exit: exit(b), checklist: checklist(b, { accountRegion: null }) })).status).toBe('unknown');
    expect(run('C2.studio_language_info', ctxOf(b)).status).toBe('info');
    expect(run('C3.checklist_complete', ctxOf(b, { checklist: checklist(b) })).status).toBe('pass');
    const missing = run('C3.checklist_complete', ctxOf(b, { checklist: checklist(b, { twofaEnabled: null }) }));
    expect(missing.status).toBe('fail');
    expect(missing.hint).toContain('twofaEnabled');
    expect(run('C3.checklist_complete', ctxOf(b, { checklist: checklist(b, { expiresAt: '2026-10-01T00:00:00.000Z' }) })).hint).toContain('hết hạn');
    expect(run('C3.checklist_complete', ctxOf(b)).status).toBe('fail');
  });

  it('D1–D5 chéo', () => {
    const a = binding(1);
    const b = binding(2);
    const c = binding(3);
    const snaps: BindingSnapshot[] = [
      { binding: a, exit: exit(a, { exitIp: '1.1.1.1' }), furyProfile: fury({ personaId: 'P', seed: 'S' }), checklist: checklist(a) },
      { binding: b, exit: exit(b, { exitIp: '1.1.1.2' }), furyProfile: fury({ personaId: 'P', seed: 'S' }), checklist: checklist(b, { recoveryEmailHmac: 'h-email-1', recoveryPhoneHmac: 'h-phone-2' }) },
      { binding: c, exit: exit(c, { exitIp: '1.1.1.1', asn: 999 }), furyProfile: fury({ personaId: 'Q', seed: undefined }), checklist: checklist(c, { recoveryEmailHmac: 'h-email-3', recoveryPhoneHmac: 'h-phone-3' }) },
    ];
    const d1 = cross('D1.unique_exit_ip', snaps);
    expect(d1.map((o) => o.status)).toEqual(['fail', 'pass', 'fail']);
    expect(d1[0]?.hint).toContain('Kênh 3');
    expect(cross('D2.unique_subnet', snaps).map((o) => o.status)).toEqual(['fail', 'fail', 'fail']);
    expect(cross('D3.unique_persona_seed', snaps).map((o) => o.status)).toEqual(['fail', 'fail', 'unknown']);
    expect(cross('D4.persona_asn_crowd', snaps, { max: 1 }).map((o) => o.status)).toEqual(['fail', 'fail', 'pass']);
    expect(cross('D4.persona_asn_crowd', snaps).map((o) => o.status)).toEqual(['pass', 'pass', 'pass']);
    const d5 = cross('D5.unique_recovery', snaps);
    expect(d5.map((o) => o.status)).toEqual(['fail', 'fail', 'pass']);
    expect(d5[0]?.hint).toContain('email khôi phục');
    expect(cross('D1.unique_exit_ip', [snaps[0]!]).map((o) => o.status)).toEqual(['pass']);
  });

  it('E1–E4 theo thời gian', () => {
    const b = binding();
    expect(run('E1.exit_stable', ctxOf(b, { exit: exit(b) })).status).toBe('pass');
    expect(run('E1.exit_stable', ctxOf(b, { exit: exit(b), previousExit: exit(b) })).status).toBe('pass');
    expect(run('E1.exit_stable', ctxOf(b, { exit: exit(b, { asn: 1 }), previousExit: exit(b) })).status).toBe('fail');
    const base = probe(b);
    expect(run('E2.noise_hash_stable', ctxOf(b, { probe: probe(b), previousProbe: base })).status).toBe('pass');
    const hc = run('E2.noise_hash_stable', ctxOf(b, { probe: probe(b, 'hash-changed'), previousProbe: base }));
    expect(hc.status).toBe('fail');
    expect(hc.hint).toContain('canvas');
    expect(run('E2.noise_hash_stable', ctxOf(b, { probe: probe(b, 'upgraded-ok'), previousProbe: base })).status).toBe('skipped');
    expect(run('E2.noise_hash_stable', ctxOf(b, { probe: base })).status).toBe('unknown');
    expect(run('E3.only_version_changed', ctxOf(b, { probe: probe(b, 'upgraded-ok'), previousProbe: base })).status).toBe('pass');
    const gpu = run('E3.only_version_changed', ctxOf(b, { probe: probe(b, 'upgraded-gpu-changed'), previousProbe: base }));
    expect(gpu.status).toBe('fail');
    expect(gpu.hint).toContain('webgl.renderer');
    expect(run('E3.only_version_changed', ctxOf(b, { probe: probe(b), previousProbe: base })).status).toBe('skipped');
    expect(run('E4.persona_unchanged', ctxOf(b, { furyProfile: fury() })).status).toBe('pass');
    expect(run('E4.persona_unchanged', ctxOf(b, { furyProfile: fury({ personaId: 'other' }) })).status).toBe('fail');
    expect(run('E4.persona_unchanged', ctxOf(binding(1, { packConfig: {} }), { furyProfile: fury() })).status).toBe('unknown');
    expect(run('E4.persona_unchanged', ctxOf(b, { furyProfileError: 'FURY_OFFLINE' })).hint).toContain('FURY_OFFLINE');
  });

  it('mọi outcome fail/unknown có hint tiếng Việt (có dấu)', () => {
    const b = binding();
    const outcomes = [
      run('A1.exit_country_matches_market', ctxOf(b, { exit: exit(b, { country: 'FR' }) })),
      run('A2.timezone_matches_exit', ctxOf(b, { exit: exit(b), probe: probe(b, 'timezone-off') })),
      run('B4.voices_fonts_os', ctxOf(b, { probe: probe(b, 'voices-macos') })),
      run('C3.checklist_complete', ctxOf(b)),
      run('E4.persona_unchanged', ctxOf(b)),
    ];
    for (const o of outcomes) expect(o.hint ?? '').toMatch(/[ăâđêôơưàáảãạ]/i);
  });
});
