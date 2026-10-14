import type { ChecklistRow } from '@sctech/profilevault-db';
import { fail, info, pass, unknown, type ConsistencyRule } from './types.js';

export const CHECKLIST_FIELDS = [
  'accountRegion',
  'channelCountry',
  'accountLanguage',
  'recoveryEmailHmac',
  'recoveryPhoneHmac',
  'twofaEnabled',
  'exclusiveLoginConfirmed',
  'studioLanguageSet',
] as const;

export function checklistMissing(c: ChecklistRow | undefined): string[] {
  if (!c) return [...CHECKLIST_FIELDS];
  return CHECKLIST_FIELDS.filter((f) => c[f] === null || c[f] === undefined);
}

/** Lớp C: profile ↔ tài khoản. */
export const LAYER_C: ConsistencyRule[] = [
  {
    id: 'C1.account_geo_aligned',
    layer: 'C',
    defaultSeverity: 'block',
    scope: 'binding',
    needs: ['checklist', 'exit'],
    defaultParams: {},
    title: 'Thị trường ↔ quốc gia proxy ↔ vùng tài khoản ↔ quốc gia kênh',
    evaluate(ctx) {
      const id = ctx.binding.id;
      const market = ctx.binding.marketCountry;
      const exit = ctx.exit?.country ?? null;
      const region = ctx.checklist?.accountRegion ?? null;
      const channel = ctx.checklist?.channelCountry ?? null;
      const actual = { market, exit, accountRegion: region, channelCountry: channel };
      if (!exit) return unknown(id, 'Chưa có kết quả kiểm proxy trong 24 giờ.', actual);
      if (!region || !channel) return unknown(id, 'Checklist chưa khai vùng tài khoản/quốc gia kênh (hiển thị như cảnh báo).', actual);
      if (market === exit && exit === region && region === channel) return pass(id, actual, market);
      const diffs: string[] = [];
      if (exit !== market) diffs.push(`exit ${exit}`);
      if (region !== market) diffs.push(`vùng tài khoản ${region}`);
      if (channel !== market) diffs.push(`quốc gia kênh ${channel}`);
      return fail(id, actual, market, `Kênh nhắm ${market} nhưng ${diffs.join(', ')} khác. Đổi proxy hoặc kiểm lại vùng tài khoản/quốc gia kênh.`);
    },
  },
  {
    id: 'C2.studio_language_info',
    layer: 'C',
    defaultSeverity: 'info',
    scope: 'binding',
    needs: [],
    defaultParams: {},
    title: 'Ngôn ngữ Studio đã ghim (thông tin)',
    evaluate(ctx) {
      return info(ctx.binding.id, {
        studioLanguage: ctx.binding.packConfig.studioLanguage ?? null,
        browserLanguages: ctx.probe?.data.navigator.languages ?? ctx.furyProfile?.languages ?? null,
      });
    },
  },
  {
    id: 'C3.checklist_complete',
    layer: 'C',
    defaultSeverity: 'block',
    scope: 'binding',
    needs: ['checklist'],
    defaultParams: {},
    title: 'Checklist tài khoản đã hoàn tất và còn hạn',
    evaluate(ctx) {
      const id = ctx.binding.id;
      const missing = checklistMissing(ctx.checklist);
      const expiresAt = ctx.checklist?.expiresAt ?? null;
      const confirmedAt = ctx.checklist?.confirmedAt ?? null;
      const expired = !expiresAt || Date.parse(expiresAt) <= ctx.now.getTime();
      if (missing.length === 0 && !expired) return pass(id, { confirmedAt, expiresAt }, 'đủ trường, còn hạn');
      const why = missing.length > 0 ? `thiếu ${missing.join(', ')}` : !confirmedAt ? 'chưa xác nhận' : `hết hạn từ ${expiresAt}`;
      return fail(id, { missing, confirmedAt, expiresAt }, 'đủ trường, còn hạn', `Checklist ${why}. Điền/xác nhận lại checklist tài khoản trên dashboard (thẻ Checklist).`);
    },
  },
];
