import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PvError, type NormalizedProbe } from '@sctech/profilevault-contract';
import { isAllowedVersionChange, parseFuryCapture, probeDiff, userAgentOnlyVersionChanged } from '../src/index.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'probes');
export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(dir, `${name}.json`), 'utf8'));
}

describe('chuẩn hóa probe (SPEC-02 §6.3, SPIKE-P3)', () => {
  it('file dạng chuẩn hóa được nhận; thiếu trường bắt buộc → INPUT_INVALID với danh sách', () => {
    const { probe, converter } = parseFuryCapture(fixture('base'));
    expect(converter).toBe('normalized');
    expect(probe.timezone).toBe('Europe/Berlin');
    let caught: unknown;
    try {
      parseFuryCapture(fixture('missing-fields'));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PvError);
    expect((caught as PvError).code).toBe('INPUT_INVALID');
    expect((caught as PvError).detail?.missing).toEqual(['navigator.languages', 'timezone']);
  });

  it('trang probe detect-suite của Fury (schema 1): ánh xạ đủ trường; phiên bản Fury lấy từ ngữ cảnh; bỏ địa chỉ mDNS', () => {
    const { probe, converter } = parseFuryCapture(fixture('fury-detect-suite'), { now: '2026-10-15T00:00:00.000Z', furyVersion: '0.3.22' });
    expect(converter).toBe('fury-detect-suite-v1');
    expect(probe).toMatchObject({
      furyVersion: '0.3.22',
      capturedAt: '2026-10-15T00:00:00.000Z',
      timezone: 'Europe/Berlin',
      navigator: { platform: 'Win32', languages: ['de-DE', 'de', 'en-US', 'en'], hardwareConcurrency: 8, deviceMemory: 8, webdriver: false },
      screen: { width: 1920, height: 1080, availHeight: 1032, colorDepth: 24, dpr: 1 },
      window: { innerWidth: 1280, innerHeight: 720 },
      uaData: { platform: 'Windows', platformVersion: '15.0.0', bitness: '64' },
      webgl: { vendor: 'Google Inc. (NVIDIA)' },
      hashes: { canvas: 'c0ffee01', webgl: 'beefcafe', audio: 'a0d10001' },
      webrtc: { candidateIps: ['198.51.100.23'] },
      geolocationPermission: 'prompt',
      contextsConsistent: true,
    });
    expect(probe.uaData?.brands).toContainEqual({ brand: 'Not.A/Brand', version: '99' });
    expect(probe.voices).toEqual(['Google Deutsch', 'Microsoft Hedda - German (Germany)']);
    expect(probe.fonts).toContain('Segoe UI');
  });

  it('probe detect-suite: thiếu phiên bản Fury (Fury offline lúc nhập) → INPUT_INVALID; bản đã che IP → không có candidate', () => {
    let caught: unknown;
    try {
      parseFuryCapture(fixture('fury-detect-suite'));
    } catch (err) {
      caught = err;
    }
    expect((caught as PvError).detail?.missing).toEqual(['furyVersion']);
    const redacted = fixture('fury-detect-suite') as { webrtc: Record<string, unknown> };
    redacted.webrtc.addresses = ['203.0.113.1'];
    redacted.webrtc.redacted = true;
    expect(parseFuryCapture(redacted, { furyVersion: '0.3.22' }).probe.webrtc.candidateIps).toEqual([]);
  });

  it('định dạng lạ → INPUT_INVALID probe_format_unknown', () => {
    expect(() => parseFuryCapture({ hello: 'world' })).toThrow(/Không nhận dạng/);
  });

  it('probeDiff và danh sách trường được phép đổi khi nâng Fury', () => {
    const a = parseFuryCapture(fixture('base')).probe;
    const b = parseFuryCapture(fixture('upgraded-ok')).probe;
    const changes = probeDiff(a, b);
    expect(changes.map((c) => c.path)).toEqual(expect.arrayContaining(['furyVersion', 'userAgent', 'uaData.brands', 'uaData.fullVersionList']));
    expect(changes.every((c) => isAllowedVersionChange(c.path))).toBe(true);
    const c = parseFuryCapture(fixture('upgraded-gpu-changed')).probe;
    expect(probeDiff(a, c).filter((x) => !isAllowedVersionChange(x.path)).map((x) => x.path)).toEqual(['webgl.renderer', 'webgl.vendor']);
    expect(userAgentOnlyVersionChanged(a.userAgent, b.userAgent)).toBe(true);
    expect(userAgentOnlyVersionChanged(a.userAgent, a.userAgent.replace('Windows NT 10.0', 'Macintosh'))).toBe(false);
    const same: NormalizedProbe = { ...a, capturedAt: '2027-01-01T00:00:00.000Z' };
    expect(probeDiff(a, same)).toEqual([]);
  });
});
