/**
 * Bộ ánh xạ endpoint của automation API Fury — NƠI DUY NHẤT biết đường dẫn và định dạng JSON của Fury.
 *
 * TODO(SPIKE-P2): toàn bộ đường dẫn, phương thức và tên trường dưới đây là GIẢ ĐỊNH (docs/progress.md G8).
 * Sau spike P2 chỉ sửa file này (và FakeFury ở src/testing/fake-fury.ts); giao diện FuryClient không đổi.
 */
import { z } from 'zod';
import {
  AsnTypeSchema,
  type ExitInfo,
  type FuryCapabilitySource,
  type FuryLaunchResult,
  type FuryProfileDetail,
  type FuryProfileStatus,
  type FuryProfileSummary,
} from '@sctech/profilevault-contract';
import { badResponse } from '../errors.js';

export type FuryCapability = 'health' | 'listProfiles' | 'getProfile' | 'getStatus' | 'launch' | 'stop' | 'checkExit';

export interface ParseContext {
  now: string;
}

export interface EndpointSpec<P, R> {
  source: 'native' | 'fallback';
  method: 'GET' | 'POST';
  path: (params: P) => string;
  body?: (params: P) => unknown;
  parse: (raw: unknown, ctx: ParseContext) => R;
}

export interface MissingEndpoint {
  source: 'missing';
}

export interface FuryEndpointMap {
  health: EndpointSpec<void, { version: string }> | MissingEndpoint;
  listProfiles: EndpointSpec<void, FuryProfileSummary[]> | MissingEndpoint;
  getProfile: EndpointSpec<{ profileId: string }, FuryProfileDetail> | MissingEndpoint;
  getStatus: EndpointSpec<{ profileId: string }, FuryProfileStatus> | MissingEndpoint;
  launch: EndpointSpec<{ profileId: string; cdp: true }, FuryLaunchResult> | MissingEndpoint;
  stop: EndpointSpec<{ profileId: string }, void> | MissingEndpoint;
  checkExit: EndpointSpec<{ profileId: string }, ExitInfo> | MissingEndpoint;
  /** Năng lực không có endpoint riêng, suy từ dữ liệu trả về. */
  meta: {
    /** `getProfile` có trả `seed` không. TODO(SPIKE-P2) */
    seed: FuryCapabilitySource;
    /** `checkExit` có trả `asnType` không. TODO(SPIKE-P5) */
    asnType: FuryCapabilitySource;
  };
}

function enc(id: string): string {
  return encodeURIComponent(id);
}

function issuesOf(err: z.ZodError): { path: string; message: string }[] {
  return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

function parseWith<T>(cap: FuryCapability, schema: z.ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (!r.success) throw badResponse(cap, issuesOf(r.error));
  return r.data;
}

function osFamilyOf(v: unknown): FuryProfileSummary['osFamily'] {
  if (typeof v !== 'string') return undefined;
  const s = v.toLowerCase();
  if (s.includes('win')) return 'windows';
  if (s.includes('mac') || s.includes('darwin')) return 'macos';
  return 'other';
}

// ---- Schema thô (lỏng, passthrough) — TODO(SPIKE-P2) tên trường giả định ----

const RawStatus = z.object({ version: z.string() }).passthrough();

const RawProfileSummary = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    name: z.string().default(''),
    tags: z.array(z.string()).optional(),
    personaId: z.string().optional(),
    persona_id: z.string().optional(),
    os: z.string().optional(),
  })
  .passthrough();

const RawPersona = z
  .object({
    platform: z.string().optional(),
    os: z.string().optional(),
    userAgent: z.string().optional(),
    gpuRenderer: z.string().optional(),
    screen: z.object({ width: z.number(), height: z.number() }).optional(),
    hardwareConcurrency: z.number().optional(),
    deviceMemory: z.number().optional(),
  })
  .passthrough();

const RawProfileDetail = RawProfileSummary.extend({
  persona: RawPersona.optional(),
  seed: z.union([z.string(), z.number()]).transform(String).optional(),
  timezone: z.string().optional(),
  languages: z.array(z.string()).optional(),
  geolocation: z
    .object({ mode: z.enum(['off', 'auto', 'manual']).optional(), lat: z.number().optional(), lon: z.number().optional() })
    .passthrough()
    .optional(),
  webrtc: z.string().optional(),
  webrtcMode: z.string().optional(),
  // Chỉ lấy định danh; host/username/password BỊ BỎ (SPEC-01 §2, Constitution IV)
  proxy: z.union([z.string(), z.object({ id: z.union([z.string(), z.number()]).optional(), name: z.string().optional() }).passthrough()]).optional(),
});

const RawProfileStatus = z
  .object({
    open: z.boolean(),
    via: z.enum(['app', 'api', 'mcp', 'unknown']).optional(),
    since: z.string().optional(),
  })
  .passthrough();

const RawLaunch = z.object({ cdpEndpoint: z.string().min(1), sessionRef: z.string().optional() }).passthrough();

const RawExit = z
  .object({
    ip: z.string().optional(),
    country: z.string().optional(),
    city: z.string().optional(),
    timezone: z.string().optional(),
    asn: z.number().int().optional(),
    asnOrg: z.string().optional(),
    asnType: z.string().optional(),
    latencyMs: z.number().int().optional(),
    error: z.string().optional(),
  })
  .passthrough();

function toSummary(raw: z.infer<typeof RawProfileSummary>): FuryProfileSummary {
  const out: FuryProfileSummary = { id: raw.id, name: raw.name, tags: raw.tags ?? [] };
  const personaId = raw.personaId ?? raw.persona_id;
  if (personaId !== undefined) out.personaId = personaId;
  const osFamily = osFamilyOf(raw.os);
  if (osFamily !== undefined) out.osFamily = osFamily;
  return out;
}

function toDetail(raw: z.infer<typeof RawProfileDetail>): FuryProfileDetail {
  const out: FuryProfileDetail = toSummary(raw);
  if (raw.persona) {
    const platform = raw.persona.platform ?? raw.persona.os;
    if (platform !== undefined) {
      out.persona = { platform };
      if (raw.persona.userAgent !== undefined) out.persona.userAgent = raw.persona.userAgent;
      if (raw.persona.gpuRenderer !== undefined) out.persona.gpuRenderer = raw.persona.gpuRenderer;
      if (raw.persona.screen !== undefined) out.persona.screen = raw.persona.screen;
      if (raw.persona.hardwareConcurrency !== undefined) out.persona.hardwareConcurrency = raw.persona.hardwareConcurrency;
      if (raw.persona.deviceMemory !== undefined) out.persona.deviceMemory = raw.persona.deviceMemory;
      if (out.osFamily === undefined) {
        const f = osFamilyOf(platform);
        if (f !== undefined) out.osFamily = f;
      }
    }
  }
  if (raw.seed !== undefined) out.seed = raw.seed;
  if (raw.timezone !== undefined) out.timezone = raw.timezone;
  if (raw.languages !== undefined) out.languages = raw.languages;
  if (raw.geolocation?.mode !== undefined) {
    out.geolocation = { mode: raw.geolocation.mode };
    if (raw.geolocation.lat !== undefined) out.geolocation.lat = raw.geolocation.lat;
    if (raw.geolocation.lon !== undefined) out.geolocation.lon = raw.geolocation.lon;
  }
  const webrtc = raw.webrtcMode ?? raw.webrtc;
  if (webrtc !== undefined) out.webrtcMode = webrtc;
  if (typeof raw.proxy === 'string') out.proxyRef = raw.proxy;
  else if (raw.proxy && typeof raw.proxy === 'object') {
    const ref = raw.proxy.id !== undefined ? String(raw.proxy.id) : raw.proxy.name;
    if (ref !== undefined) out.proxyRef = ref;
  }
  return out;
}

/** Bộ ánh xạ mặc định — TODO(SPIKE-P2): xác minh từng route với Fury thật. */
export const DEFAULT_ENDPOINT_MAP: FuryEndpointMap = {
  health: {
    source: 'native',
    method: 'GET',
    path: () => '/api/status',
    parse: (raw) => ({ version: parseWith('health', RawStatus, raw).version }),
  },
  listProfiles: {
    source: 'native',
    method: 'GET',
    path: () => '/api/profiles',
    parse: (raw) => {
      const list = parseWith('listProfiles', z.union([z.array(RawProfileSummary), z.object({ profiles: z.array(RawProfileSummary) })]), raw);
      return (Array.isArray(list) ? list : list.profiles).map(toSummary);
    },
  },
  getProfile: {
    source: 'native',
    method: 'GET',
    path: ({ profileId }) => `/api/profiles/${enc(profileId)}`,
    parse: (raw) => toDetail(parseWith('getProfile', RawProfileDetail, raw)),
  },
  getStatus: {
    source: 'native',
    method: 'GET',
    path: ({ profileId }) => `/api/profiles/${enc(profileId)}/status`,
    parse: (raw) => {
      const s = parseWith('getStatus', RawProfileStatus, raw);
      const out: FuryProfileStatus = { open: s.open };
      if (s.via !== undefined) out.via = s.via;
      if (s.since !== undefined) out.since = s.since;
      return out;
    },
  },
  launch: {
    source: 'native',
    method: 'POST',
    path: ({ profileId }) => `/api/profiles/${enc(profileId)}/launch`,
    body: ({ cdp }) => ({ cdp }),
    parse: (raw) => {
      const l = parseWith('launch', RawLaunch, raw);
      return { cdpEndpoint: l.cdpEndpoint, sessionRef: l.sessionRef ?? '' };
    },
  },
  stop: {
    source: 'native',
    method: 'POST',
    path: ({ profileId }) => `/api/profiles/${enc(profileId)}/stop`,
    parse: () => undefined,
  },
  checkExit: {
    // TODO(SPIKE-P5): Fury có kiểm exit không mở trình duyệt không; định dạng asnType.
    source: 'native',
    method: 'POST',
    path: ({ profileId }) => `/api/profiles/${enc(profileId)}/check-exit`,
    parse: (raw, ctx) => {
      const e = parseWith('checkExit', RawExit, raw);
      const asnType = e.asnType !== undefined ? AsnTypeSchema.safeParse(e.asnType.toLowerCase()) : undefined;
      const out: ExitInfo = { ok: e.error === undefined && e.ip !== undefined, checkedAt: ctx.now };
      if (e.ip !== undefined) out.ip = e.ip;
      if (e.country !== undefined) out.country = e.country.toUpperCase();
      if (e.city !== undefined) out.city = e.city;
      if (e.timezone !== undefined) out.timezone = e.timezone;
      if (e.asn !== undefined) out.asn = e.asn;
      if (e.asnOrg !== undefined) out.asnOrg = e.asnOrg;
      out.asnType = asnType?.success ? asnType.data : 'unknown';
      if (e.latencyMs !== undefined) out.latencyMs = e.latencyMs;
      if (e.error !== undefined) out.error = e.error;
      return out;
    },
  },
  meta: {
    seed: 'missing', // TODO(SPIKE-P2)
    asnType: 'fallback', // TODO(SPIKE-P5): nếu Fury trả asnType → native
  },
};
