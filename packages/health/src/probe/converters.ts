/**
 * Bộ chuyển đổi file probe thô → NormalizedProbe (SPEC-02 §6.3).
 * TODO(SPIKE-P3): định dạng xuất thật của trang probe Fury chưa biết; `furyCaptureV1Converter` là giả định.
 * Sau spike: sửa/thêm converter ở đây, giữ `parseFuryCapture` và luật nguyên.
 */
import { NormalizedProbeSchema, type NormalizedProbe } from '@sctech/profilevault-contract';

export interface ProbeConverter {
  id: string;
  /** Có nhận dạng được định dạng này không. */
  detect(raw: unknown): boolean;
  /** Chuyển sang dạng gần `NormalizedProbe` (chưa kiểm). */
  convert(raw: unknown, ctx: { now: string }): unknown;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** File đã đúng dạng NormalizedProbe (dùng cho test và cho công cụ xuất sau này). */
export const normalizedProbeConverter: ProbeConverter = {
  id: 'normalized',
  detect: (raw) => isObj(raw) && typeof raw.userAgent === 'string' && isObj(raw.navigator) && isObj(raw.screen) && 'hashes' in raw,
  convert: (raw, ctx) => {
    const o = raw as Record<string, unknown>;
    return { capturedAt: ctx.now, ...o };
  },
};

/**
 * TODO(SPIKE-P3): giả định trang probe Fury xuất `{ meta: { furyVersion, capturedAt }, fingerprint: { ... } }`
 * với tên trường kiểu camelCase như dưới. Chỉ ánh xạ, không đoán giá trị.
 */
export const furyCaptureV1Converter: ProbeConverter = {
  id: 'fury-capture-v1',
  detect: (raw) => isObj(raw) && isObj(raw.fingerprint) && (isObj(raw.meta) || typeof raw.furyVersion === 'string'),
  convert: (raw, ctx) => {
    const o = raw as Record<string, unknown>;
    const meta = isObj(o.meta) ? o.meta : {};
    const fp = o.fingerprint as Record<string, unknown>;
    const nav = isObj(fp.navigator) ? fp.navigator : {};
    const screen = isObj(fp.screen) ? fp.screen : {};
    const webrtc = isObj(fp.webrtc) ? fp.webrtc : {};
    const out: Record<string, unknown> = {
      furyVersion: meta.furyVersion ?? o.furyVersion,
      capturedAt: meta.capturedAt ?? ctx.now,
      userAgent: fp.userAgent ?? nav.userAgent,
      uaData: fp.userAgentData ?? fp.uaData,
      navigator: {
        platform: nav.platform,
        languages: nav.languages ?? (typeof nav.language === 'string' ? [nav.language] : undefined),
        hardwareConcurrency: nav.hardwareConcurrency,
        deviceMemory: nav.deviceMemory,
        maxTouchPoints: nav.maxTouchPoints,
        webdriver: nav.webdriver ?? false,
      },
      screen: {
        width: screen.width,
        height: screen.height,
        availWidth: screen.availWidth ?? screen.width,
        availHeight: screen.availHeight ?? screen.height,
        colorDepth: screen.colorDepth ?? 24,
        dpr: screen.devicePixelRatio ?? screen.dpr ?? 1,
      },
      window: isObj(fp.window) ? fp.window : undefined,
      timezone: fp.timezone ?? (isObj(fp.intl) ? fp.intl.timeZone : undefined),
      geolocationPermission: fp.geolocationPermission,
      webgl: isObj(fp.webgl) ? { vendor: fp.webgl.vendor ?? fp.webgl.unmaskedVendor, renderer: fp.webgl.renderer ?? fp.webgl.unmaskedRenderer } : undefined,
      hashes: {
        canvas: isObj(fp.canvas) ? fp.canvas.hash : fp.canvasHash,
        webgl: isObj(fp.webgl) ? fp.webgl.hash : fp.webglHash,
        audio: isObj(fp.audio) ? fp.audio.hash : fp.audioHash,
      },
      voices: Array.isArray(fp.voices) ? fp.voices.map((v: unknown) => (isObj(v) && typeof v.name === 'string' ? v.name : String(v))) : [],
      fonts: Array.isArray(fp.fonts) ? fp.fonts : [],
      webrtc: { candidateIps: Array.isArray(webrtc.candidateIps) ? webrtc.candidateIps : Array.isArray(webrtc.ips) ? webrtc.ips : [] },
      dns: isObj(fp.dns) ? { resolverCountry: fp.dns.resolverCountry ?? fp.dns.country } : undefined,
      contextsConsistent: fp.contextsConsistent,
    };
    return out;
  },
};

export const DEFAULT_PROBE_CONVERTERS: ProbeConverter[] = [normalizedProbeConverter, furyCaptureV1Converter];

export { NormalizedProbeSchema, type NormalizedProbe };
