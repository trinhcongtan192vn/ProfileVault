import { newId, PvError, type Binding, type Clock, type ExitInfo, type ProxyCheck } from '@sctech/profilevault-contract';
import type { Logger } from '@sctech/profilevault-core';
import type { BindingsRepo, ProxyChecksRepo } from '@sctech/profilevault-db';
import type { FuryClient } from '@sctech/profilevault-fury-client';
import type { LevelPolicy, PendingBusEvent } from './level-policy.js';

export interface ProxyCheckDeps {
  fury: FuryClient;
  clock: Clock;
  bindings: BindingsRepo;
  proxyChecks: ProxyChecksRepo;
  policy: LevelPolicy;
  logger: Logger;
}

/** Kiểm exit proxy qua Fury, không mở trình duyệt (SPEC-02 §5, §7; PRD F3). */
export class ProxyCheckService {
  constructor(private readonly d: ProxyCheckDeps) {}

  /** Kiểm một binding: ghi `proxy_checks`, so với lần ok trước (R2), phát hiện trùng exit IP (R3). */
  async check(bindingId: string): Promise<{ check: ProxyCheck; bus: PendingBusEvent[] }> {
    const binding = this.d.bindings.get(bindingId);
    if (!binding) throw new PvError('ACCOUNT_NOT_BOUND', 'Không có binding', { bindingId });
    if (binding.archivedAt) throw new PvError('INPUT_INVALID', 'Binding đã lưu trữ', { bindingId });

    let exit: ExitInfo;
    try {
      exit = await this.d.fury.checkExit(binding.furyProfileId);
    } catch (err) {
      const code = err instanceof PvError ? err.code : 'INTERNAL';
      exit = { ok: false, error: code, checkedAt: this.d.clock.nowIso() };
    }

    const { result, bus } = this.d.policy.transact(() => this.record(binding, exit));
    return { check: result, bus };
  }

  private record(binding: Binding, exit: ExitInfo): ProxyCheck {
    const check: ProxyCheck = {
      id: newId('proxyCheck', this.d.clock.nowMs()),
      bindingId: binding.id,
      ok: exit.ok,
      exitIp: exit.ip ?? null,
      country: exit.country ?? null,
      city: exit.city ?? null,
      timezone: exit.timezone ?? null,
      asn: exit.asn ?? null,
      asnOrg: exit.asnOrg ?? null,
      asnType: exit.asnType ?? null,
      latencyMs: exit.latencyMs ?? null,
      error: exit.error ?? null,
      checkedAt: this.d.clock.nowIso(),
    };
    this.d.proxyChecks.insert(check);
    this.d.policy.onChanged?.(binding.id);

    if (!exit.ok) {
      // Fury không có nguồn kiểm exit (API công khai 0.3.22 — TODO(SPIKE-P5)): không có bằng chứng, không phải cờ đỏ
      if (check.error === 'FURY_CAPABILITY_MISSING') return check;
      this.d.policy.recordEvent(binding.id, 'proxy.check_failed', { error: check.error, proxyCheckId: check.id });
      return check;
    }

    const prev = this.d.proxyChecks.latestOk(binding.id, check.id);
    if (prev) {
      if (prev.country && check.country && prev.country !== check.country) {
        const ev = this.d.policy.recordEvent(binding.id, 'proxy.country_changed', { from: prev.country, to: check.country, proxyCheckId: check.id });
        this.d.policy.applyProxyChanged(binding, { eventId: ev.id, proxyCheckId: check.id, field: 'country', from: prev.country, to: check.country });
      } else if (prev.asn !== null && check.asn !== null && prev.asn !== check.asn) {
        const ev = this.d.policy.recordEvent(binding.id, 'proxy.asn_changed', { from: prev.asn, to: check.asn, proxyCheckId: check.id });
        this.d.policy.applyProxyChanged(binding, { eventId: ev.id, proxyCheckId: check.id, field: 'asn', from: prev.asn, to: check.asn });
      }
    }

    this.detectDuplicateExit();
    return check;
  }

  /** Nhóm binding chưa archive theo exit IP của lần kiểm ok gần nhất → R3 (research R6). */
  detectDuplicateExit(): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const c of this.d.proxyChecks.latestOkPerBinding()) {
      if (!c.exitIp) continue;
      const list = groups.get(c.exitIp) ?? [];
      list.push(c.bindingId);
      groups.set(c.exitIp, list);
    }
    this.d.policy.applyDuplicateExitIp(groups);
    return groups;
  }
}
