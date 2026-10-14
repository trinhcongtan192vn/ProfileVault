/**
 * Bộ chuyển đổi file probe thô → NormalizedProbe (SPEC-02 §6.3).
 * Đã xác minh ở SPIKE-P3 (2026-10-15) với mã nguồn trang probe của Fury 0.3.22
 * (`tools/detect-suite/probe.js`, `__schema: 1`, `__probeVersion: '0.3.0'`): nút "Скачать JSON" / "Скопировать JSON"
 * xuất nguyên đối tượng `furyProbe()`. File KHÔNG chứa phiên bản Fury và thời điểm đo → lấy từ ngữ cảnh nhập.
 */
import { NormalizedProbeSchema, type NormalizedProbe } from '@sctech/profilevault-contract';

export interface ProbeConvertContext {
  now: string;
  /** Phiên bản Fury đang chạy lúc nhập (file probe không ghi phiên bản). */
  furyVersion?: string;
}

export interface ProbeConverter {
  id: string;
  /** Có nhận dạng được định dạng này không. */
  detect(raw: unknown): boolean;
  /** Chuyển sang dạng gần `NormalizedProbe` (chưa kiểm). */
  convert(raw: unknown, ctx: ProbeConvertContext): unknown;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Probe ghi lỗi từng vector dạng `{ __error }` / `{ __absent }`: coi như không có. */
function present(v: unknown): v is Record<string, unknown> {
  return isObj(v) && !('__error' in v) && !('__absent' in v) && !('__timeout' in v);
}
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) ? v : undefined);
const list = (v: unknown, sep = ','): string[] => (typeof v === 'string' && v.length > 0 ? v.split(sep).map((s) => s.trim()).filter(Boolean) : []);

/** `"Brand/ver,Brand/ver"` → `[{ brand, version }]`. */
function brands(v: unknown): { brand: string; version: string }[] {
  return list(v).map((pair) => {
    const i = pair.lastIndexOf('/');
    return i > 0 ? { brand: pair.slice(0, i), version: pair.slice(i + 1) } : { brand: pair, version: '' };
  });
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

/** Trang probe detect-suite của Fury (`probe.js`, schema 1). */
export const furyDetectSuiteConverter: ProbeConverter = {
  id: 'fury-detect-suite-v1',
  detect: (raw) => isObj(raw) && raw.__schema === 1 && isObj(raw.navigator) && isObj(raw.locale) && isObj(raw.screen),
  convert: (raw, ctx) => {
    const o = raw as Record<string, unknown>;
    const nav = o.navigator as Record<string, unknown>;
    const screen = o.screen as Record<string, unknown>;
    const locale = o.locale as Record<string, unknown>;
    const ch = present(o.clientHints) ? o.clientHints : undefined;
    const webgl = isObj(o.webgl) ? o.webgl : {};
    const gl = [webgl.webgl1, webgl.webgl2].find((x) => present(x) && present(x.unmasked)) as Record<string, unknown> | undefined;
    const unmasked = gl?.unmasked as Record<string, unknown> | undefined;
    const glRender = [webgl.webgl1, webgl.webgl2].map((x) => (present(x) && present(x.render) ? str(x.render.readPixels) : undefined)).find(Boolean);
    const canvas = present(o.canvas2d) ? o.canvas2d : undefined;
    const audio = present(o.audio) && present(o.audio.offline) ? o.audio.offline : undefined;
    const speech = present(o.speech) ? o.speech : undefined;
    const fonts = present(o.fonts) ? o.fonts : undefined;
    const webrtc = present(o.webrtc) ? o.webrtc : undefined;
    const perms = present(o.permissions) ? o.permissions : undefined;
    const cross = present(o.crossContext) ? o.crossContext : undefined;
    const geo = str(perms?.geolocation);
    // Bản tải từ trang host công khai thay IP bằng 203.0.113.x (`redacted`): không dùng được cho luật rò rỉ
    const addresses = webrtc && webrtc.redacted !== true && Array.isArray(webrtc.addresses) ? webrtc.addresses.filter((a): a is string => typeof a === 'string' && !/\.local$/i.test(a)) : [];
    const languages = list(nav.languages);
    const lang = str(nav.language);
    return {
      furyVersion: ctx.furyVersion,
      capturedAt: ctx.now,
      userAgent: str(nav.userAgent),
      uaData: ch
        ? {
            platform: str(ch.platform) ?? '',
            platformVersion: str(ch.platformVersion),
            brands: brands(ch.brands),
            fullVersionList: str(ch.fullVersionList) ? brands(ch.fullVersionList) : undefined,
            architecture: str(ch.architecture),
            bitness: str(ch.bitness),
          }
        : undefined,
      navigator: {
        platform: str(nav.platform),
        languages: languages.length > 0 ? languages : lang ? [lang] : [],
        hardwareConcurrency: int(nav.hardwareConcurrency),
        deviceMemory: num(nav.deviceMemory),
        maxTouchPoints: int(nav.maxTouchPoints),
        webdriver: nav.webdriver === true,
      },
      screen: {
        width: int(screen.width),
        height: int(screen.height),
        availWidth: int(screen.availWidth) ?? int(screen.width),
        availHeight: int(screen.availHeight) ?? int(screen.height),
        colorDepth: int(screen.colorDepth) ?? 24,
        dpr: num(screen.devicePixelRatio) ?? 1,
      },
      window: int(screen.innerWidth) !== undefined && int(screen.innerHeight) !== undefined ? { innerWidth: int(screen.innerWidth), innerHeight: int(screen.innerHeight) } : undefined,
      timezone: str(locale.timezone),
      geolocationPermission: geo === 'granted' || geo === 'denied' || geo === 'prompt' ? geo : undefined,
      webgl: unmasked && str(unmasked.renderer) ? { vendor: str(unmasked.vendor) ?? '', renderer: str(unmasked.renderer) } : undefined,
      hashes: { canvas: str(canvas?.getImageData) ?? str(canvas?.toDataURL), webgl: glRender, audio: str(audio?.hash) },
      // `names` = "Tên|lang|local~…"
      voices: list(speech?.names, '~').map((v) => v.split('|')[0] ?? v).filter(Boolean),
      fonts: Array.isArray(fonts?.detectedByMeasurement) ? fonts.detectedByMeasurement.filter((f): f is string => typeof f === 'string') : [],
      webrtc: { candidateIps: addresses },
      contextsConsistent: typeof cross?.consistent === 'boolean' ? cross.consistent : undefined,
    };
  },
};

export const DEFAULT_PROBE_CONVERTERS: ProbeConverter[] = [normalizedProbeConverter, furyDetectSuiteConverter];

export { NormalizedProbeSchema, type NormalizedProbe };
