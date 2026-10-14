import { isAllowedVersionChange, probeDiff, userAgentOnlyVersionChanged } from '../probe/diff.js';
import { fail, pass, skipped, unknown, type ConsistencyRule } from './types.js';

/** Lớp E: theo thời gian. */
export const LAYER_E: ConsistencyRule[] = [
  {
    id: 'E1.exit_stable',
    layer: 'E',
    defaultSeverity: 'block',
    scope: 'binding',
    needs: ['exit'],
    defaultParams: {},
    title: 'Exit proxy giữ quốc gia + ASN so với lần trước',
    evaluate(ctx) {
      const id = ctx.binding.id;
      if (!ctx.exit) return unknown(id, 'Chưa có kết quả kiểm proxy.');
      if (!ctx.previousExit) return pass(id, { country: ctx.exit.country, asn: ctx.exit.asn }, 'lần kiểm đầu');
      const same = ctx.exit.country === ctx.previousExit.country && ctx.exit.asn === ctx.previousExit.asn;
      if (same) return pass(id, { country: ctx.exit.country, asn: ctx.exit.asn }, { country: ctx.previousExit.country, asn: ctx.previousExit.asn });
      return fail(id, { country: ctx.exit.country, asn: ctx.exit.asn }, { country: ctx.previousExit.country, asn: ctx.previousExit.asn }, `Exit đổi từ ${ctx.previousExit.country}/AS${ctx.previousExit.asn} sang ${ctx.exit.country}/AS${ctx.exit.asn}. Xác nhận exit mới trên dashboard hoặc đổi lại proxy.`);
    },
  },
  {
    id: 'E2.noise_hash_stable',
    layer: 'E',
    defaultSeverity: 'block',
    scope: 'binding',
    needs: ['probe', 'previousProbe'],
    defaultParams: {},
    title: 'Hash canvas/WebGL/audio giữ nguyên giữa hai lần đo cùng phiên bản Fury',
    evaluate(ctx) {
      const id = ctx.binding.id;
      if (!ctx.probe) return unknown(id, 'Chưa có probe.');
      if (!ctx.previousProbe) return unknown(id, 'Mới có một probe; nhập probe lần hai cùng phiên bản Fury để so hash.');
      if (ctx.probe.furyVersion !== ctx.previousProbe.furyVersion) return skipped(id, 'Hai probe khác phiên bản Fury; xem E3.');
      const a = ctx.probe.data.hashes;
      const b = ctx.previousProbe.data.hashes;
      const changed = (['canvas', 'webgl', 'audio'] as const).filter((k) => a[k] !== undefined && b[k] !== undefined && a[k] !== b[k]);
      if (changed.length === 0) return pass(id, a, b);
      return fail(id, a, b, `Hash ${changed.join(', ')} đổi giữa hai lần đo cùng phiên bản Fury ${ctx.probe.furyVersion}. Kiểm tra profile có bị đổi persona/seed hoặc chạy fury-detect gate.`);
    },
  },
  {
    id: 'E3.only_version_changed',
    layer: 'E',
    defaultSeverity: 'block',
    scope: 'binding',
    needs: ['probe', 'previousProbe'],
    defaultParams: {},
    title: 'Sau khi nâng Fury chỉ phiên bản trình duyệt/UA đổi',
    evaluate(ctx) {
      const id = ctx.binding.id;
      if (!ctx.probe) return unknown(id, 'Chưa có probe.');
      if (!ctx.previousProbe) return unknown(id, 'Mới có một probe; chưa so sánh được qua nâng cấp.');
      if (ctx.probe.furyVersion === ctx.previousProbe.furyVersion) return skipped(id, 'Cùng phiên bản Fury; xem E2.');
      const changes = probeDiff(ctx.previousProbe.data, ctx.probe.data);
      const bad = changes.filter((c) => !isAllowedVersionChange(c.path));
      if (!userAgentOnlyVersionChanged(ctx.previousProbe.data.userAgent, ctx.probe.data.userAgent)) bad.push({ path: 'userAgent(structure)', before: ctx.previousProbe.data.userAgent, after: ctx.probe.data.userAgent });
      if (bad.length === 0) return pass(id, changes.map((c) => c.path), 'chỉ phiên bản đổi');
      return fail(id, bad.map((c) => ({ path: c.path, before: c.before, after: c.after })), 'chỉ phiên bản đổi', `Sau khi nâng Fury ${ctx.previousProbe.furyVersion} → ${ctx.probe.furyVersion}, ${bad.map((c) => c.path).join(', ')} cũng đổi. Kiểm tra persona của profile hoặc lùi phiên bản Fury.`);
    },
  },
  {
    id: 'E4.persona_unchanged',
    layer: 'E',
    defaultSeverity: 'block',
    scope: 'binding',
    needs: ['furyProfile'],
    defaultParams: {},
    title: 'Không đổi persona của profile đang có binding',
    evaluate(ctx) {
      const id = ctx.binding.id;
      const atBind = ctx.binding.packConfig._personaAtBind;
      if (!ctx.furyProfile) return unknown(id, ctx.furyProfileError ? `Không đọc được cấu hình Fury (${ctx.furyProfileError}).` : 'Không đọc được cấu hình Fury.');
      if (typeof atBind !== 'string') return unknown(id, 'Chưa ghi nhận persona lúc gắn kênh (Fury offline khi tạo binding). Sửa binding để ghi lại.', { current: ctx.furyProfile.personaId ?? null });
      if (!ctx.furyProfile.personaId) return unknown(id, 'Fury không trả personaId hiện tại.', { atBind });
      if (ctx.furyProfile.personaId === atBind) return pass(id, ctx.furyProfile.personaId, atBind);
      return fail(id, ctx.furyProfile.personaId, atBind, `Persona của profile đã đổi từ ${atBind} sang ${ctx.furyProfile.personaId} sau khi gắn kênh. Khôi phục persona cũ trong Fury hoặc tạo binding mới.`);
    },
  },
];
