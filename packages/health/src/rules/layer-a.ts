import { tzOffsetMs } from '../local-time.js';
import { cityCoords, distanceKm, timezoneCountry } from './data.js';
import { fail, num, pass, unknown, type ConsistencyRule } from './types.js';

const NO_EXIT = 'Chưa có kết quả kiểm proxy trong 24 giờ. Chạy "Kiểm proxy ngay" trên dashboard.';

function offsetOf(tz: string, now: Date): number | undefined {
  try {
    return tzOffsetMs(now, tz);
  } catch {
    return undefined;
  }
}

/** Lớp A: profile ↔ mạng (SPEC-02 §6.4). */
export const LAYER_A: ConsistencyRule[] = [
  {
    id: 'A1.exit_country_matches_market',
    layer: 'A',
    defaultSeverity: 'block',
    scope: 'binding',
    needs: ['exit'],
    defaultParams: {},
    title: 'Quốc gia exit proxy = thị trường kênh',
    evaluate(ctx) {
      const id = ctx.binding.id;
      if (!ctx.exit?.country) return unknown(id, NO_EXIT);
      const market = ctx.binding.marketCountry;
      if (ctx.exit.country === market) return pass(id, ctx.exit.country, market);
      return fail(id, ctx.exit.country, market, `Exit đang ở ${ctx.exit.country}, kênh nhắm ${market}. Đổi proxy trong Fury hoặc sửa thị trường của kênh.`);
    },
  },
  {
    id: 'A2.timezone_matches_exit',
    layer: 'A',
    defaultSeverity: 'block',
    scope: 'binding',
    needs: ['exit', 'probe'],
    defaultParams: {},
    title: 'Múi giờ trình duyệt khớp vị trí exit',
    evaluate(ctx) {
      const id = ctx.binding.id;
      if (!ctx.exit) return unknown(id, NO_EXIT);
      const exitTz = ctx.exit.timezone;
      if (!exitTz) return unknown(id, 'Kết quả kiểm proxy không có múi giờ của exit; không so sánh được.');
      const tz = ctx.probe?.data.timezone ?? ctx.furyProfile?.timezone;
      if (!tz) return unknown(id, ctx.furyProfileError ? `Chưa có probe và không đọc được cấu hình Fury (${ctx.furyProfileError}).` : 'Chưa có probe và cấu hình Fury không có múi giờ. Nhập file probe.');
      if (tz === 'auto') return pass(id, 'auto', exitTz);
      if (tz === exitTz) return pass(id, tz, exitTz);
      const a = offsetOf(tz, ctx.now);
      const b = offsetOf(exitTz, ctx.now);
      if (a === undefined || b === undefined) return unknown(id, `Múi giờ không hợp lệ: ${a === undefined ? tz : exitTz}.`, tz);
      const tzCountry = timezoneCountry(tz, ctx.data.timezoneCountries);
      const exitCountry = timezoneCountry(exitTz, ctx.data.timezoneCountries) ?? ctx.exit.country ?? undefined;
      if (a !== b) return fail(id, tz, exitTz, `Múi giờ profile là ${tz} (lệch ${(b - a) / 3_600_000} giờ so với exit). Đặt múi giờ profile = ${exitTz} trong Fury.`);
      if (!tzCountry || !exitCountry) return unknown(id, `Không xác định được quốc gia của múi giờ ${!tzCountry ? tz : exitTz}; cập nhật bảng timezone-countries.`, tz);
      if (tzCountry !== exitCountry) return fail(id, tz, exitTz, `Múi giờ ${tz} thuộc ${tzCountry}, exit ở ${exitCountry}. Đặt múi giờ profile = ${exitTz}.`);
      return pass(id, tz, exitTz);
    },
  },
  {
    id: 'A3.language_plausible',
    layer: 'A',
    defaultSeverity: 'warn',
    scope: 'binding',
    needs: ['probe', 'exit'],
    defaultParams: {},
    title: 'Ngôn ngữ trình duyệt hợp lý với quốc gia exit',
    evaluate(ctx) {
      const id = ctx.binding.id;
      if (!ctx.exit?.country) return unknown(id, NO_EXIT);
      const langs = ctx.probe?.data.navigator.languages ?? ctx.furyProfile?.languages;
      if (!langs || langs.length === 0) return unknown(id, 'Chưa có probe và cấu hình Fury không có ngôn ngữ. Nhập file probe.');
      const first = (langs[0] ?? '').split('-')[0]?.toLowerCase() ?? '';
      const allowed = ctx.data.countryLanguages.countries[ctx.exit.country];
      if (!allowed) return unknown(id, `Chưa có bảng ngôn ngữ cho quốc gia ${ctx.exit.country}.`, langs[0]);
      const ok = first === 'en' || allowed.includes(first);
      if (ok) return pass(id, langs[0], allowed);
      return fail(id, langs[0], allowed, `Ngôn ngữ đầu tiên là ${langs[0]}, exit ở ${ctx.exit.country}. Đặt ngôn ngữ đầu tiên = ${allowed[0]} (hoặc en) trong Fury.`);
    },
  },
  {
    id: 'A4.geolocation_off_or_matches',
    layer: 'A',
    defaultSeverity: 'block',
    scope: 'binding',
    needs: ['furyProfile', 'exit'],
    defaultParams: { maxKm: 150 },
    title: 'Geolocation tắt hoặc khớp vị trí exit',
    evaluate(ctx, params) {
      const id = ctx.binding.id;
      const geo = ctx.furyProfile?.geolocation;
      if (!geo) return unknown(id, ctx.furyProfileError ? `Không đọc được cấu hình Fury (${ctx.furyProfileError}).` : 'Cấu hình Fury không cho biết geolocation.');
      if (geo.mode === 'off' || geo.mode === 'auto') return pass(id, geo.mode, 'off|auto');
      if (!ctx.exit?.country) return unknown(id, NO_EXIT, geo);
      if (geo.lat === undefined || geo.lon === undefined) return fail(id, geo, 'tọa độ hợp lệ', 'Geolocation ở chế độ thủ công nhưng không có tọa độ. Tắt geolocation hoặc đặt theo vị trí exit.');
      const coords = ctx.exit.city ? cityCoords(ctx.exit.country, ctx.exit.city, ctx.data.cityCoords) : undefined;
      if (!coords) return unknown(id, `Chưa có tọa độ cho thành phố exit "${ctx.exit.city ?? '?'}" (${ctx.exit.country}). Tắt geolocation hoặc đặt theo vị trí exit.`, geo);
      const km = Math.round(distanceKm([geo.lat, geo.lon], coords));
      const maxKm = num(params, 'maxKm', 150);
      if (km <= maxKm) return pass(id, { lat: geo.lat, lon: geo.lon, km }, `≤ ${maxKm} km`);
      return fail(id, { lat: geo.lat, lon: geo.lon, km }, `≤ ${maxKm} km tới ${ctx.exit.city}`, `Tọa độ geolocation cách ${ctx.exit.city} ${km} km. Tắt geolocation hoặc đặt theo vị trí exit.`);
    },
  },
  {
    id: 'A5.asn_residential',
    layer: 'A',
    defaultSeverity: 'block',
    scope: 'binding',
    needs: ['exit'],
    defaultParams: {},
    title: 'ASN exit là ISP/residential',
    evaluate(ctx) {
      const id = ctx.binding.id;
      if (!ctx.exit) return unknown(id, NO_EXIT);
      let type = ctx.exit.asnType ?? 'unknown';
      let source = 'fury';
      if (type === 'unknown' && ctx.exit.asn !== null) {
        const att = ctx.attestations.get(ctx.exit.asn);
        if (att) {
          type = att;
          source = 'attestation';
        }
      }
      const org = ctx.exit.asnOrg ?? `AS${ctx.exit.asn ?? '?'}`;
      if (type === 'isp' || type === 'residential') return pass(id, { asn: ctx.exit.asn, type, source }, 'isp|residential');
      if (type === 'mobile') return fail(id, { asn: ctx.exit.asn, type, source }, 'isp|residential', `ASN ${org} là mạng di động; chấp nhận được nhưng nên dùng proxy ISP/residential tĩnh.`, 'warn');
      if (type === 'hosting') return fail(id, { asn: ctx.exit.asn, type, source }, 'isp|residential', `ASN ${org} là hosting/datacenter. Dùng proxy ISP/residential tĩnh.`);
      return unknown(id, `Chưa phân loại được ASN ${org} — xác nhận loại ASN trên dashboard (Cài đặt → ASN).`, { asn: ctx.exit.asn, type: 'unknown' });
    },
  },
  {
    id: 'A6.no_leaks',
    layer: 'A',
    defaultSeverity: 'block',
    scope: 'binding',
    needs: ['probe', 'exit'],
    defaultParams: {},
    title: 'Không rò WebRTC, DNS đi qua proxy',
    evaluate(ctx) {
      const id = ctx.binding.id;
      if (!ctx.probe) return unknown(id, 'Chưa có probe. Nhập file probe để kiểm WebRTC/DNS.');
      if (!ctx.exit?.exitIp) return unknown(id, NO_EXIT);
      const publicIps = ctx.probe.data.webrtc.candidateIps.filter((ip) => !isPrivateIp(ip));
      const leaked = publicIps.filter((ip) => ip !== ctx.exit?.exitIp);
      if (leaked.length > 0) return fail(id, { candidateIps: ctx.probe.data.webrtc.candidateIps }, { exitIp: ctx.exit.exitIp }, `WebRTC lộ IP ${leaked.join(', ')} khác exit ${ctx.exit.exitIp}. Đặt WebRTC = replace/disable trong Fury.`);
      const dnsCountry = ctx.probe.data.dns?.resolverCountry;
      if (dnsCountry && ctx.exit.country && dnsCountry.toUpperCase() !== ctx.exit.country) {
        return fail(id, { dnsCountry }, { exitCountry: ctx.exit.country }, `DNS ra từ ${dnsCountry}, exit ở ${ctx.exit.country}. Bật DNS qua proxy trong Fury.`);
      }
      return pass(id, { candidateIps: ctx.probe.data.webrtc.candidateIps, dnsCountry: dnsCountry ?? null }, { exitIp: ctx.exit.exitIp });
    },
  },
];

/** IP nội bộ/mDNS không coi là rò (giả định G23). */
export function isPrivateIp(ip: string): boolean {
  if (ip.endsWith('.local')) return true;
  if (/^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || /^127\./.test(ip) || /^169\.254\./.test(ip)) return true;
  if (/^(fc|fd|fe80)/i.test(ip) || ip === '::1') return true;
  return false;
}
