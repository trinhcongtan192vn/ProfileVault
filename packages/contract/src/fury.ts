import { z } from 'zod';
import { IsoDateTimeSchema } from './common.js';

/** Kiểu dữ liệu FuryClient (SPEC-01 §3). Trường `?` có thể thiếu tùy nguồn; nơi dùng coi `undefined` là `unknown`. */

export const AsnTypeSchema = z.enum(['isp', 'residential', 'mobile', 'hosting', 'unknown']);
export type AsnType = z.infer<typeof AsnTypeSchema>;

export const FuryHealthSchema = z.object({
  reachable: z.boolean(),
  version: z.string().optional(),
  supported: z.boolean(),
  checkedAt: IsoDateTimeSchema,
  /** Lý do không reachable: url_invalid | timeout | network | auth | bad_response | server */
  error: z.string().optional(),
});
export type FuryHealth = z.infer<typeof FuryHealthSchema>;

export const OsFamilySchema = z.enum(['windows', 'macos', 'other']);

export const FuryProfileSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  tags: z.array(z.string()),
  personaId: z.string().optional(),
  osFamily: OsFamilySchema.optional(),
});
export type FuryProfileSummary = z.infer<typeof FuryProfileSummarySchema>;

export const FuryPersonaSchema = z.object({
  platform: z.string(),
  userAgent: z.string().optional(),
  gpuRenderer: z.string().optional(),
  screen: z.object({ width: z.number().int(), height: z.number().int() }).optional(),
  hardwareConcurrency: z.number().int().optional(),
  deviceMemory: z.number().optional(),
});

export const FuryGeolocationSchema = z.object({
  mode: z.enum(['off', 'auto', 'manual']),
  lat: z.number().optional(),
  lon: z.number().optional(),
});

export const FuryProfileDetailSchema = FuryProfileSummarySchema.extend({
  persona: FuryPersonaSchema.optional(),
  seed: z.string().optional(),
  timezone: z.string().optional(),
  languages: z.array(z.string()).optional(),
  geolocation: FuryGeolocationSchema.optional(),
  webrtcMode: z.string().optional(),
  /** Định danh proxy trong Fury; KHÔNG BAO GIỜ chứa thông tin đăng nhập. */
  proxyRef: z.string().optional(),
});
export type FuryProfileDetail = z.infer<typeof FuryProfileDetailSchema>;

export const FuryProfileStatusSchema = z.object({
  open: z.boolean(),
  via: z.enum(['app', 'api', 'mcp', 'unknown']).optional(),
  since: z.string().optional(),
});
export type FuryProfileStatus = z.infer<typeof FuryProfileStatusSchema>;

export const FuryLaunchResultSchema = z.object({
  cdpEndpoint: z.string().min(1),
  sessionRef: z.string(),
});
export type FuryLaunchResult = z.infer<typeof FuryLaunchResultSchema>;

export const ExitInfoSchema = z.object({
  ok: z.boolean(),
  ip: z.string().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  timezone: z.string().optional(),
  asn: z.number().int().optional(),
  asnOrg: z.string().optional(),
  asnType: AsnTypeSchema.optional(),
  latencyMs: z.number().int().optional(),
  error: z.string().optional(),
  checkedAt: IsoDateTimeSchema,
});
export type ExitInfo = z.infer<typeof ExitInfoSchema>;

export const FURY_CAPABILITY_NAMES = [
  'listProfiles',
  'getStatus',
  'launchCdp',
  'stop',
  'profileConfig',
  'seed',
  'checkExit',
  'asnType',
] as const;
export const FuryCapabilityNameSchema = z.enum(FURY_CAPABILITY_NAMES);
export type FuryCapabilityName = z.infer<typeof FuryCapabilityNameSchema>;

export const FuryCapabilitySourceSchema = z.enum(['native', 'fallback', 'missing']);
export type FuryCapabilitySource = z.infer<typeof FuryCapabilitySourceSchema>;

export const FuryCapabilitiesSchema = z.object(
  Object.fromEntries(FURY_CAPABILITY_NAMES.map((n) => [n, FuryCapabilitySourceSchema])) as Record<
    FuryCapabilityName,
    typeof FuryCapabilitySourceSchema
  >,
);
export type FuryCapabilities = z.infer<typeof FuryCapabilitiesSchema>;
