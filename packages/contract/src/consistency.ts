import { z } from 'zod';
import { CountryCodeSchema, IsoDateTimeSchema, JsonObjectSchema } from './common.js';
import { RuleStatusSchema, SeveritySchema } from './enums.js';
import { AsnTypeSchema } from './fury.js';
import { BindingIdSchema, ConsistencyRunIdSchema, ProbeIdSchema, RuleIdSchema } from './ids.js';

// ---- Probe chuẩn hóa (SPEC-02 §6.3) — [SPIKE-P3] ----

const BrandSchema = z.object({ brand: z.string(), version: z.string() });

export const NormalizedProbeSchema = z.object({
  furyVersion: z.string().min(1),
  capturedAt: IsoDateTimeSchema,
  userAgent: z.string().min(1),
  uaData: z
    .object({
      platform: z.string(),
      platformVersion: z.string().optional(),
      brands: z.array(BrandSchema),
      fullVersionList: z.array(BrandSchema).optional(),
      architecture: z.string().optional(),
      bitness: z.string().optional(),
    })
    .optional(),
  navigator: z.object({
    platform: z.string().min(1),
    languages: z.array(z.string()).min(1),
    hardwareConcurrency: z.number().int().optional(),
    deviceMemory: z.number().optional(),
    maxTouchPoints: z.number().int().optional(),
    webdriver: z.boolean(),
  }),
  screen: z.object({
    width: z.number().int(),
    height: z.number().int(),
    availWidth: z.number().int(),
    availHeight: z.number().int(),
    colorDepth: z.number().int(),
    dpr: z.number(),
  }),
  window: z.object({ innerWidth: z.number().int(), innerHeight: z.number().int() }).optional(),
  timezone: z.string().min(1),
  geolocationPermission: z.enum(['granted', 'denied', 'prompt']).optional(),
  webgl: z.object({ vendor: z.string(), renderer: z.string() }).optional(),
  hashes: z.object({ canvas: z.string().optional(), webgl: z.string().optional(), audio: z.string().optional() }),
  voices: z.array(z.string()),
  fonts: z.array(z.string()),
  webrtc: z.object({ candidateIps: z.array(z.string()) }),
  dns: z.object({ resolverCountry: z.string().optional() }).optional(),
  contextsConsistent: z.boolean().optional(),
});
export type NormalizedProbe = z.infer<typeof NormalizedProbeSchema>;

/** Trường bắt buộc của probe (SPEC-02 §6.3). */
export const PROBE_REQUIRED_PATHS = ['furyVersion', 'userAgent', 'navigator.platform', 'navigator.languages', 'screen', 'timezone', 'webrtc'] as const;

export const ProbeResultSchema = z.object({
  id: ProbeIdSchema,
  bindingId: BindingIdSchema,
  furyVersion: z.string(),
  source: z.enum(['manual_import', 'flow']),
  capturedAt: IsoDateTimeSchema,
  data: NormalizedProbeSchema,
  rawPath: z.string(),
  createdAt: IsoDateTimeSchema,
});
export type ProbeResult = z.infer<typeof ProbeResultSchema>;

// ---- Luật (SPEC-02 §6.1, §6.4) ----

export const RuleLayerSchema = z.enum(['A', 'B', 'C', 'D', 'E']);
export type RuleLayer = z.infer<typeof RuleLayerSchema>;

export const RULE_IDS = [
  'A1.exit_country_matches_market',
  'A2.timezone_matches_exit',
  'A3.language_plausible',
  'A4.geolocation_off_or_matches',
  'A5.asn_residential',
  'A6.no_leaks',
  'B1.os_matches_host',
  'B2.gpu_class_plausible',
  'B3.screen_fits_host',
  'B4.voices_fonts_os',
  'C1.account_geo_aligned',
  'C2.studio_language_info',
  'C3.checklist_complete',
  'D1.unique_exit_ip',
  'D2.unique_subnet',
  'D3.unique_persona_seed',
  'D4.persona_asn_crowd',
  'D5.unique_recovery',
  'E1.exit_stable',
  'E2.noise_hash_stable',
  'E3.only_version_changed',
  'E4.persona_unchanged',
] as const;
export type KnownRuleId = (typeof RULE_IDS)[number];

export const RuleOutcomeSchema = z.object({
  bindingId: BindingIdSchema,
  status: RuleStatusSchema,
  actual: z.unknown().optional(),
  expected: z.unknown().optional(),
  hint: z.string().optional(),
  /** Luật tự hạ mức (A5 `mobile` → warn). */
  severityOverride: SeveritySchema.optional(),
  /** Dữ liệu cũ > 14 ngày (SPEC-02 §6.5). */
  stale: z.boolean().optional(),
});
export type RuleOutcome = z.infer<typeof RuleOutcomeSchema>;

export const RuleConfigSchema = z.object({
  id: RuleIdSchema,
  layer: RuleLayerSchema,
  severity: SeveritySchema,
  enabled: z.boolean(),
  params: JsonObjectSchema,
  updatedAt: IsoDateTimeSchema,
});
export type RuleConfig = z.infer<typeof RuleConfigSchema>;

export const RulePatchSchema = z.object({ severity: SeveritySchema.optional(), enabled: z.boolean().optional(), params: JsonObjectSchema.optional() });
export type RulePatch = z.infer<typeof RulePatchSchema>;

export const ConsistencyResultRowSchema = z.object({
  runId: ConsistencyRunIdSchema,
  bindingId: BindingIdSchema,
  ruleId: RuleIdSchema,
  status: RuleStatusSchema,
  severity: SeveritySchema,
  actual: z.unknown().optional(),
  expected: z.unknown().optional(),
  hint: z.string().nullable(),
});
export type ConsistencyResultRow = z.infer<typeof ConsistencyResultRowSchema>;

export const ConsistencyScoreSchema = z.object({
  passed: z.number().int(),
  total: z.number().int(),
  blockFailing: z.number().int(),
  blockUnknown: z.number().int(),
  /** `passed / total`, `null` khi `total = 0`. */
  ratio: z.number().min(0).max(1).nullable(),
});
export type ConsistencyScore = z.infer<typeof ConsistencyScoreSchema>;

export const ConsistencyTriggerSchema = z.enum([
  'binding_created',
  'binding_updated',
  'probe_imported',
  'proxy_checked',
  'checklist_changed',
  'fury_version_changed',
  'persona_changed',
  'asn_attested',
  'periodic',
  'before_promote',
  'manual',
  'checklist_expired',
]);
export type ConsistencyTrigger = z.infer<typeof ConsistencyTriggerSchema>;

export const BindingConsistencySchema = z.object({
  bindingId: BindingIdSchema,
  score: ConsistencyScoreSchema,
  results: z.array(ConsistencyResultRowSchema),
});

export const ConsistencyRunSummarySchema = z.object({
  runId: ConsistencyRunIdSchema,
  trigger: ConsistencyTriggerSchema,
  startedAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema,
  bindings: z.array(BindingConsistencySchema),
});
export type ConsistencyRunSummary = z.infer<typeof ConsistencyRunSummarySchema>;
export type BindingConsistency = z.infer<typeof BindingConsistencySchema>;

// ---- Checklist tài khoản (SPEC-02 §6.8) ----

export const ChecklistInputSchema = z.object({
  accountRegion: CountryCodeSchema.optional(),
  channelCountry: CountryCodeSchema.optional(),
  accountLanguage: z.string().min(2).optional(),
  recoveryEmail: z.string().optional(),
  recoveryPhone: z.string().optional(),
  twofaEnabled: z.boolean().optional(),
  exclusiveLoginConfirmed: z.boolean().optional(),
  studioLanguageSet: z.boolean().optional(),
});
export type ChecklistInput = z.infer<typeof ChecklistInputSchema>;

/** Trạng thái checklist cho dashboard/API — KHÔNG BAO GIỜ chứa email/số gốc. */
export const ChecklistStatusSchema = z.object({
  bindingId: BindingIdSchema,
  accountRegion: z.string().nullable(),
  channelCountry: z.string().nullable(),
  accountLanguage: z.string().nullable(),
  hasRecoveryEmail: z.boolean(),
  hasRecoveryPhone: z.boolean(),
  twofaEnabled: z.boolean().nullable(),
  exclusiveLoginConfirmed: z.boolean().nullable(),
  studioLanguageSet: z.boolean().nullable(),
  confirmedAt: IsoDateTimeSchema.nullable(),
  expiresAt: IsoDateTimeSchema.nullable(),
  updatedAt: IsoDateTimeSchema.nullable(),
  complete: z.boolean(),
  expired: z.boolean(),
  missing: z.array(z.string()),
});
export type ChecklistStatus = z.infer<typeof ChecklistStatusSchema>;

export const CHECKLIST_VALIDITY_DAYS = 90;

// ---- Host (SPIKE-P6) ----

export const HostSnapshotSchema = z.object({
  os: z.string(),
  osVersion: z.string(),
  gpus: z.array(z.object({ name: z.string(), vramMb: z.number().int().optional() })),
  displays: z.array(z.object({ width: z.number().int(), height: z.number().int(), primary: z.boolean().optional() })),
  ramMb: z.number().int(),
  capturedAt: IsoDateTimeSchema,
});
export type HostSnapshot = z.infer<typeof HostSnapshotSchema>;

// ---- ASN ----

export const AsnAttestationInputSchema = z.object({
  asn: z.number().int().positive(),
  asnType: AsnTypeSchema.exclude(['unknown']),
  note: z.string().max(500).optional(),
});
export type AsnAttestationInput = z.infer<typeof AsnAttestationInputSchema>;

// ---- Ma trận chéo (SPEC-07 §4.6) ----

export const CrossMatrixCellSchema = z.object({
  a: BindingIdSchema,
  b: BindingIdSchema,
  kind: z.enum(['exit_ip', 'subnet', 'asn_persona', 'recovery']),
  level: z.enum(['red', 'yellow']),
  detail: z.string(),
});
export const CrossMatrixSchema = z.object({
  bindingIds: z.array(BindingIdSchema),
  cells: z.array(CrossMatrixCellSchema),
  computedAt: IsoDateTimeSchema,
});
export type CrossMatrix = z.infer<typeof CrossMatrixSchema>;
