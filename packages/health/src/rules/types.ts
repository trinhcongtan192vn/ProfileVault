import type { AsnType, Binding, FuryProfileDetail, HostSnapshot, KnownRuleId, ProbeResult, ProxyCheck, RuleLayer, RuleOutcome, Severity } from '@sctech/profilevault-contract';
import type { ChecklistRow } from '@sctech/profilevault-db';
import type { RuleData } from './data.js';

/** Dữ liệu một binding dùng cho luật chéo (SPEC-02 §6.2 `allBindings`). */
export interface BindingSnapshot {
  binding: Binding;
  exit?: ProxyCheck;
  furyProfile?: FuryProfileDetail;
  checklist?: ChecklistRow;
  probe?: ProbeResult;
}

/** RuleContext (SPEC-02 §6.2). Khóa thiếu → luật trả `unknown`. */
export interface RuleContext {
  binding: Binding;
  furyProfile?: FuryProfileDetail;
  /** Lý do không có furyProfile (ví dụ Fury offline) để ghi vào hint. */
  furyProfileError?: string;
  exit?: ProxyCheck;
  previousExit?: ProxyCheck;
  probe?: ProbeResult;
  previousProbe?: ProbeResult;
  host?: HostSnapshot;
  checklist?: ChecklistRow;
  allBindings: BindingSnapshot[];
  attestations: Map<number, AsnType>;
  now: Date;
  data: RuleData;
}

export type DataKey = 'furyProfile' | 'exit' | 'probe' | 'previousProbe' | 'host' | 'checklist' | 'allBindings';

export interface ConsistencyRule {
  id: KnownRuleId;
  layer: RuleLayer;
  defaultSeverity: Severity;
  scope: 'binding' | 'cross';
  needs: DataKey[];
  defaultParams: Record<string, unknown>;
  /** Mô tả ngắn tiếng Việt (dashboard). */
  title: string;
  evaluate(ctx: RuleContext, params: Record<string, unknown>): RuleOutcome | RuleOutcome[];
}

// ---- helper tạo outcome ----
export const pass = (bindingId: string, actual?: unknown, expected?: unknown): RuleOutcome => ({ bindingId, status: 'pass', actual, expected });
export const fail = (bindingId: string, actual: unknown, expected: unknown, hint: string, severityOverride?: Severity): RuleOutcome => ({
  bindingId,
  status: 'fail',
  actual,
  expected,
  hint,
  ...(severityOverride ? { severityOverride } : {}),
});
export const unknown = (bindingId: string, hint: string, actual?: unknown): RuleOutcome => ({ bindingId, status: 'unknown', hint, actual });
export const info = (bindingId: string, actual: unknown): RuleOutcome => ({ bindingId, status: 'info', actual });
export const skipped = (bindingId: string, hint?: string): RuleOutcome => ({ bindingId, status: 'skipped', hint });

export function num(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
