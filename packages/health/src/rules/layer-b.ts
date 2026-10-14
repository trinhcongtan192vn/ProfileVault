import { foreignOsSignatures, gpuTier } from './data.js';
import { fail, num, pass, unknown, type ConsistencyRule, type RuleContext } from './types.js';

function personaIsWindows(ctx: RuleContext): boolean | undefined {
  if (ctx.probe) {
    const n = ctx.probe.data.navigator.platform;
    const ua = ctx.probe.data.userAgent;
    return n === 'Win32' && /Windows/i.test(ua);
  }
  if (ctx.furyProfile) {
    if (ctx.furyProfile.osFamily) return ctx.furyProfile.osFamily === 'windows';
    if (ctx.furyProfile.persona?.platform) return /win/i.test(ctx.furyProfile.persona.platform);
  }
  return undefined;
}

/** Lớp B: profile ↔ máy chạy. */
export const LAYER_B: ConsistencyRule[] = [
  {
    id: 'B1.os_matches_host',
    layer: 'B',
    defaultSeverity: 'block',
    scope: 'binding',
    needs: ['probe', 'host'],
    defaultParams: {},
    title: 'OS persona = OS máy chạy (Windows)',
    evaluate(ctx) {
      const id = ctx.binding.id;
      if (!ctx.host) return unknown(id, 'Chưa có thông tin máy chạy (host_snapshots).');
      const persona = personaIsWindows(ctx);
      if (persona === undefined) return unknown(id, 'Chưa biết OS của persona: nhập probe hoặc chờ Fury trả cấu hình.');
      const hostWindows = ctx.host.os === 'windows';
      if (persona && hostWindows) return pass(id, 'windows', 'windows');
      return fail(id, { persona: persona ? 'windows' : 'other', host: ctx.host.os }, 'windows = windows', `Persona ${persona ? 'Windows' : 'không phải Windows'} trên máy ${ctx.host.os}. Dùng persona Windows trên máy Windows (fury-detect persona chụp từ máy này).`);
    },
  },
  {
    id: 'B2.gpu_class_plausible',
    layer: 'B',
    defaultSeverity: 'warn',
    scope: 'binding',
    needs: ['probe', 'host'],
    defaultParams: { maxTierGap: 1 },
    title: 'Hạng GPU persona hợp lý so với GPU thật',
    evaluate(ctx, params) {
      const id = ctx.binding.id;
      if (!ctx.probe?.data.webgl?.renderer) return unknown(id, 'Probe không có renderer WebGL.');
      if (!ctx.host || ctx.host.gpus.length === 0) return unknown(id, 'Chưa đọc được GPU của máy (SPIKE-P6).');
      const personaTier = gpuTier(ctx.probe.data.webgl.renderer, ctx.data.gpuTiers);
      const hostTiers = ctx.host.gpus.map((g) => gpuTier(g.name, ctx.data.gpuTiers)).filter((t): t is number => t !== undefined);
      if (personaTier === undefined) return unknown(id, `Chưa xếp hạng được GPU persona "${ctx.probe.data.webgl.renderer}"; cập nhật bảng gpu-tiers.`);
      if (hostTiers.length === 0) return unknown(id, `Chưa xếp hạng được GPU máy "${ctx.host.gpus.map((g) => g.name).join(', ')}"; cập nhật bảng gpu-tiers.`);
      const hostTier = Math.max(...hostTiers);
      const gap = Math.abs(personaTier - hostTier);
      const maxGap = num(params, 'maxTierGap', 1);
      if (gap <= maxGap) return pass(id, { personaTier, hostTier }, `chênh ≤ ${maxGap}`);
      return fail(id, { persona: ctx.probe.data.webgl.renderer, personaTier, host: ctx.host.gpus.map((g) => g.name), hostTier }, `chênh ≤ ${maxGap}`, `GPU persona hạng ${personaTier}, GPU thật hạng ${hostTier}. Chọn persona có GPU gần ${ctx.host.gpus[0]?.name ?? 'GPU máy'}.`);
    },
  },
  {
    id: 'B3.screen_fits_host',
    layer: 'B',
    defaultSeverity: 'warn',
    scope: 'binding',
    needs: ['probe', 'host'],
    defaultParams: {},
    title: 'Độ phân giải persona ≤ màn hình thật',
    evaluate(ctx) {
      const id = ctx.binding.id;
      if (!ctx.probe) return unknown(id, 'Chưa có probe.');
      if (!ctx.host || ctx.host.displays.length === 0) return unknown(id, 'Chưa đọc được màn hình của máy (SPIKE-P6).');
      const maxW = Math.max(...ctx.host.displays.map((d) => d.width));
      const maxH = Math.max(...ctx.host.displays.map((d) => d.height));
      const s = ctx.probe.data.screen;
      if (s.width > maxW || s.height > maxH) {
        return fail(id, { width: s.width, height: s.height }, { maxWidth: maxW, maxHeight: maxH }, `Persona khai ${s.width}×${s.height}, màn hình lớn nhất là ${maxW}×${maxH}. Chọn persona có độ phân giải ≤ ${maxW}×${maxH}.`);
      }
      const w = ctx.probe.data.window;
      if (w && w.innerWidth > s.availWidth) {
        return fail(id, { innerWidth: w.innerWidth }, { availWidth: s.availWidth }, `Cửa sổ rộng ${w.innerWidth} vượt availWidth ${s.availWidth}. Mở cửa sổ nhỏ hơn hoặc sửa persona.`);
      }
      return pass(id, { width: s.width, height: s.height }, { maxWidth: maxW, maxHeight: maxH });
    },
  },
  {
    id: 'B4.voices_fonts_os',
    layer: 'B',
    defaultSeverity: 'block',
    scope: 'binding',
    needs: ['probe'],
    defaultParams: {},
    title: 'Voices/fonts không lộ hệ điều hành khác',
    evaluate(ctx) {
      const id = ctx.binding.id;
      if (!ctx.probe) return unknown(id, 'Chưa có probe.');
      const voices = foreignOsSignatures(ctx.probe.data.voices, 'windows', ctx.data.osSignatures, 'voices');
      const fonts = foreignOsSignatures(ctx.probe.data.fonts, 'windows', ctx.data.osSignatures, 'fonts');
      if (voices.length === 0 && fonts.length === 0) return pass(id, { voices: ctx.probe.data.voices.length, fonts: ctx.probe.data.fonts.length });
      const parts = [...voices.map((v) => `voices lộ ${v.os}: ${v.hits.slice(0, 3).join(', ')}`), ...fonts.map((f) => `fonts lộ ${f.os}: ${f.hits.slice(0, 3).join(', ')}`)];
      return fail(id, { voices, fonts }, 'không có chữ ký OS khác', `${parts.join('; ')}. Dùng persona cùng OS với máy (Windows).`);
    },
  },
];
