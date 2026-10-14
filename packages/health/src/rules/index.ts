import type { KnownRuleId, RuleConfig } from '@sctech/profilevault-contract';
import { LAYER_A } from './layer-a.js';
import { LAYER_B } from './layer-b.js';
import { LAYER_C } from './layer-c.js';
import { LAYER_D } from './layer-d.js';
import { LAYER_E } from './layer-e.js';
import type { ConsistencyRule } from './types.js';

/** 21 luật SPEC-02 §6.4. */
export const ALL_RULES: ConsistencyRule[] = [...LAYER_A, ...LAYER_B, ...LAYER_C, ...LAYER_D, ...LAYER_E];
export const RULES_BY_ID: ReadonlyMap<KnownRuleId, ConsistencyRule> = new Map(ALL_RULES.map((r) => [r.id, r]));

/** Luật có cơ chế dừng riêng (R2/R3) — không tính vào R4 (SPEC-02 §4.1). */
export const RULES_WITH_OWN_PAUSE: ReadonlySet<string> = new Set(['D1.unique_exit_ip', 'E1.exit_stable']);

export function defaultRuleConfigs(updatedAt: string): RuleConfig[] {
  return ALL_RULES.map((r) => ({ id: r.id, layer: r.layer, severity: r.defaultSeverity, enabled: true, params: { ...r.defaultParams }, updatedAt }));
}

export { LAYER_A, LAYER_B, LAYER_C, LAYER_D, LAYER_E };
export * from './types.js';
export { loadRuleData, gpuTier, timezoneCountry, cityCoords, distanceKm, foreignOsSignatures, DATA_DIR, type RuleData } from './data.js';
export { isPrivateIp } from './layer-a.js';
export { subnetOf } from './layer-d.js';
export { checklistMissing, CHECKLIST_FIELDS } from './layer-c.js';
