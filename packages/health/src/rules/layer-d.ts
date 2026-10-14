import type { RuleOutcome } from '@sctech/profilevault-contract';
import { fail, num, pass, unknown, type BindingSnapshot, type ConsistencyRule, type RuleContext } from './types.js';

export function subnetOf(ip: string): string | undefined {
  if (ip.includes(':')) {
    const parts = ip.split(':');
    if (parts.length < 3) return undefined;
    return `${parts.slice(0, 3).join(':')}::/48`;
  }
  const m = /^(\d+)\.(\d+)\.(\d+)\.\d+$/.exec(ip);
  return m ? `${m[1]}.${m[2]}.${m[3]}.0/24` : undefined;
}

function groupBy<T>(items: T[], key: (t: T) => string | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    if (k === undefined) continue;
    const list = out.get(k) ?? [];
    list.push(it);
    out.set(k, list);
  }
  return out;
}

function names(peers: BindingSnapshot[]): string {
  return peers.map((p) => p.binding.displayName).join(', ');
}

/** Lớp D: giữa các profile (luật chéo, mỗi outcome một binding). */
export const LAYER_D: ConsistencyRule[] = [
  {
    id: 'D1.unique_exit_ip',
    layer: 'D',
    defaultSeverity: 'block',
    scope: 'cross',
    needs: ['allBindings'],
    defaultParams: {},
    title: 'Không hai kênh chung exit IP',
    evaluate(ctx) {
      const groups = groupBy(ctx.allBindings, (s) => s.exit?.exitIp ?? undefined);
      return ctx.allBindings.map((s) => {
        if (!s.exit?.exitIp) return unknown(s.binding.id, 'Chưa có exit IP (chạy kiểm proxy).');
        const peers = (groups.get(s.exit.exitIp) ?? []).filter((p) => p.binding.id !== s.binding.id);
        if (peers.length === 0) return pass(s.binding.id, s.exit.exitIp);
        return fail(s.binding.id, s.exit.exitIp, 'IP riêng', `Kênh ${s.binding.displayName} và ${names(peers)} cùng exit IP ${s.exit.exitIp}. Đổi proxy cho một trong hai.`);
      });
    },
  },
  {
    id: 'D2.unique_subnet',
    layer: 'D',
    defaultSeverity: 'warn',
    scope: 'cross',
    needs: ['allBindings'],
    defaultParams: {},
    title: 'Không hai kênh chung dải /24 (IPv4) hoặc /48 (IPv6)',
    evaluate(ctx) {
      const groups = groupBy(ctx.allBindings, (s) => (s.exit?.exitIp ? subnetOf(s.exit.exitIp) : undefined));
      return ctx.allBindings.map((s) => {
        const subnet = s.exit?.exitIp ? subnetOf(s.exit.exitIp) : undefined;
        if (!subnet) return unknown(s.binding.id, 'Chưa có exit IP (chạy kiểm proxy).');
        const peers = (groups.get(subnet) ?? []).filter((p) => p.binding.id !== s.binding.id);
        if (peers.length === 0) return pass(s.binding.id, subnet);
        return fail(s.binding.id, subnet, 'dải riêng', `Kênh ${s.binding.displayName} và ${names(peers)} cùng dải ${subnet}. Nên dùng proxy ở dải mạng khác.`);
      });
    },
  },
  {
    id: 'D3.unique_persona_seed',
    layer: 'D',
    defaultSeverity: 'block',
    scope: 'cross',
    needs: ['allBindings'],
    defaultParams: {},
    title: 'Không hai profile trùng cặp persona + seed',
    evaluate(ctx) {
      const key = (s: BindingSnapshot) => (s.furyProfile?.personaId && s.furyProfile.seed ? `${s.furyProfile.personaId}|${s.furyProfile.seed}` : undefined);
      const groups = groupBy(ctx.allBindings, key);
      return ctx.allBindings.map((s) => {
        if (!s.furyProfile) return unknown(s.binding.id, 'Không đọc được cấu hình profile từ Fury.');
        if (!s.furyProfile.seed) return unknown(s.binding.id, 'Fury không trả seed nhiễu (SPIKE-P2); không so trùng được.', { personaId: s.furyProfile.personaId ?? null });
        const k = key(s);
        const peers = (k ? groups.get(k) ?? [] : []).filter((p) => p.binding.id !== s.binding.id);
        if (peers.length === 0) return pass(s.binding.id, { personaId: s.furyProfile.personaId });
        return fail(s.binding.id, { personaId: s.furyProfile.personaId, seed: '…' }, 'cặp riêng', `Profile của ${s.binding.displayName} và ${names(peers)} trùng persona và seed. Tạo lại profile với persona/seed khác trong Fury.`);
      });
    },
  },
  {
    id: 'D4.persona_asn_crowd',
    layer: 'D',
    defaultSeverity: 'warn',
    scope: 'cross',
    needs: ['allBindings'],
    defaultParams: { max: 3 },
    title: 'Không quá N profile cùng persona trên cùng ASN',
    evaluate(ctx, params) {
      const max = num(params, 'max', 3);
      const key = (s: BindingSnapshot) => (s.furyProfile?.personaId && s.exit?.asn !== null && s.exit?.asn !== undefined ? `${s.furyProfile.personaId}|${s.exit.asn}` : undefined);
      const groups = groupBy(ctx.allBindings, key);
      return ctx.allBindings.map((s) => {
        const k = key(s);
        if (!k) return unknown(s.binding.id, 'Thiếu persona hoặc ASN để đếm.');
        const n = groups.get(k)?.length ?? 0;
        if (n <= max) return pass(s.binding.id, { personaId: s.furyProfile?.personaId, asn: s.exit?.asn, count: n }, `≤ ${max}`);
        return fail(s.binding.id, { personaId: s.furyProfile?.personaId, asn: s.exit?.asn, count: n }, `≤ ${max}`, `${n} kênh cùng persona ${s.furyProfile?.personaId} trên ASN ${s.exit?.asn} (tối đa ${max}). Đa dạng persona hoặc ASN.`);
      });
    },
  },
  {
    id: 'D5.unique_recovery',
    layer: 'D',
    defaultSeverity: 'block',
    scope: 'cross',
    needs: ['allBindings'],
    defaultParams: {},
    title: 'Email/số khôi phục không trùng giữa các kênh',
    evaluate(ctx) {
      const byEmail = groupBy(ctx.allBindings, (s) => s.checklist?.recoveryEmailHmac ?? undefined);
      const byPhone = groupBy(ctx.allBindings, (s) => s.checklist?.recoveryPhoneHmac ?? undefined);
      return ctx.allBindings.map((s): RuleOutcome => {
        const c = s.checklist;
        if (!c || (!c.recoveryEmailHmac && !c.recoveryPhoneHmac)) return unknown(s.binding.id, 'Checklist chưa khai email/số khôi phục.');
        const emailPeers = c.recoveryEmailHmac ? (byEmail.get(c.recoveryEmailHmac) ?? []).filter((p) => p.binding.id !== s.binding.id) : [];
        const phonePeers = c.recoveryPhoneHmac ? (byPhone.get(c.recoveryPhoneHmac) ?? []).filter((p) => p.binding.id !== s.binding.id) : [];
        if (emailPeers.length === 0 && phonePeers.length === 0) return pass(s.binding.id, { email: !!c.recoveryEmailHmac, phone: !!c.recoveryPhoneHmac });
        const parts: string[] = [];
        if (emailPeers.length > 0) parts.push(`email khôi phục với ${names(emailPeers)}`);
        if (phonePeers.length > 0) parts.push(`số khôi phục với ${names(phonePeers)}`);
        return fail(s.binding.id, { duplicateEmailWith: emailPeers.map((p) => p.binding.id), duplicatePhoneWith: phonePeers.map((p) => p.binding.id) }, 'riêng', `Kênh ${s.binding.displayName} dùng chung ${parts.join(' và ')}. Mỗi kênh cần email/số khôi phục riêng.`);
      });
    },
  },
];

export function crossContext(ctx: RuleContext): BindingSnapshot[] {
  return ctx.allBindings;
}
