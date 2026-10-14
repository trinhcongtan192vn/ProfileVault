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

describe('chuẩn hóa probe (SPEC-02 §6.3, TODO(SPIKE-P3))', () => {
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

  it('bộ chuyển đổi fury-capture-v1 (giả định) ánh xạ đủ trường bắt buộc', () => {
    const { probe, converter } = parseFuryCapture(fixture('fury-capture-v1'));
    expect(converter).toBe('fury-capture-v1');
    expect(probe).toMatchObject({ furyVersion: '0.2.23', timezone: 'Europe/Berlin', navigator: { platform: 'Win32', languages: ['de-DE', 'de', 'en'] }, hashes: { canvas: 'c1a2', webgl: 'w3b4', audio: 'a5c6' }, webrtc: { candidateIps: ['5.6.7.8'] }, dns: { resolverCountry: 'DE' } });
    expect(probe.voices).toEqual(['Microsoft David - English (United States)']);
    expect(probe.webgl?.vendor).toBe('Google Inc. (NVIDIA)');
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
