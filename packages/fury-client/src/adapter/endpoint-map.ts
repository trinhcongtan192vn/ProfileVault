/**
 * Bộ ánh xạ endpoint của automation API Fury — NƠI DUY NHẤT biết đường dẫn và định dạng JSON của Fury.
 *
 * Đã xác minh ở SPIKE-P2 (2026-10-14, Fury 0.3.22): mã nguồn agent/src/http.rs + agent/src/ipc.rs và gọi thật
 * `GET /v1/status`, `GET /v1/profiles`, `GET /v1/personas`. API bật bằng biến môi trường `FURY_API_PORT` của
 * `fury-agent serve`, chỉ nghe 127.0.0.1, bearer token trong `<thư mục dữ liệu Fury>/api-token`, từ chối
 * request có `Origin`. Mọi phản hồi có dạng `{ ok: true, data }`; lỗi là `{ error, message }` với HTTP 400/401/403/404.
 * Chỉ có 6 endpoint: không có lấy một profile, trạng thái một profile hay kiểm exit proxy.
 */
import { z } from 'zod';
import {
  AsnTypeSchema,
  PvError,
  type ExitInfo,
  type FuryCapabilitySource,
  type FuryLaunchResult,
  type FuryProfileDetail,
  type FuryProfileStatus,
  type FuryProfileSummary,
} from '@sctech/profilevault-contract';
import { badResponse, profileNotFound } from '../errors.js';

export type FuryCapability = 'health' | 'listProfiles' | 'getProfile' | 'getStatus' | 'launch' | 'stop' | 'checkExit' | 'personas';

export interface ParseContext {
  now: string;
  /** Tham số của lời gọi (vd `profileId` khi endpoint trả cả danh sách). */
  params?: unknown;
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

/** Persona trong danh mục Fury (`GET /v1/personas`). */
export interface FuryPersonaInfo {
  id: string;
  os?: string;
  gpu?: string;
  screen?: { width: number; height: number };
}

export interface FuryEndpointMap {
  health: EndpointSpec<void, { version: string }> | MissingEndpoint;
  listProfiles: EndpointSpec<void, FuryProfileSummary[]> | MissingEndpoint;
  getProfile: EndpointSpec<{ profileId: string }, FuryProfileDetail> | MissingEndpoint;
  getStatus: EndpointSpec<{ profileId: string }, FuryProfileStatus> | MissingEndpoint;
  launch: EndpointSpec<{ profileId: string; cdp: true }, FuryLaunchResult> | MissingEndpoint;
  stop: EndpointSpec<{ profileId: string }, void> | MissingEndpoint;
  checkExit: EndpointSpec<{ profileId: string }, ExitInfo> | MissingEndpoint;
  /** Danh mục persona, để bổ sung OS/GPU/màn hình cho `getProfile`. */
  personas: EndpointSpec<void, FuryPersonaInfo[]> | MissingEndpoint;
  /** Năng lực không có endpoint riêng, suy từ dữ liệu trả về. */
  meta: {
    /** `getProfile` có trả `seed` không. */
    seed: FuryCapabilitySource;
    /** `checkExit` có trả `asnType` không. TODO(SPIKE-P5) */
    asnType: FuryCapabilitySource;
    /** Sửa văn bản JSON trước khi parse (vd số nguyên 64 bit → chuỗi). */
    normalizeJson?: (text: string) => string;
  };
}

function issuesOf(err: z.ZodError): { path: string; message: string }[] {
  return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

function parseWith<T>(cap: FuryCapability, schema: z.ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (!r.success) throw badResponse(cap, issuesOf(r.error));
  return r.data;
}

export function osFamilyOf(v: unknown): FuryProfileSummary['osFamily'] {
  if (typeof v !== 'string') return undefined;
  const s = v.toLowerCase();
  if (s.startsWith('win') || s.includes('windows')) return 'windows';
  if (s.startsWith('mac') || s.includes('macos') || s.includes('darwin')) return 'macos';
  return 'other';
}

/** `{ ok: true, data }` → `data`. */
function envelope<T extends z.ZodType>(data: T) {
  return z.object({ ok: z.literal(true), data });
}

/**
 * `fp_seed` là u64 (vd 7021075368349779267) — vượt Number.MAX_SAFE_INTEGER, JSON.parse làm tròn.
 * Đổi thành chuỗi trước khi parse để luật D3/E2 so đúng seed.
 */
export function quoteBigSeeds(text: string): string {
  return text.replace(/("fp_seed"\s*:\s*)(-?\d+)/g, '$1"$2"');
}

// ---- Schema thô (passthrough) — đã xác minh với Fury 0.3.22 ----

const RawStatus = z.object({ version: z.string() }).passthrough();

const RawProfile = z
  .object({
    id: z.string().min(1),
    name: z.string().default(''),
    tags: z.array(z.string()).nullish(),
    persona_id: z.string().nullish(),
    fp_seed: z.union([z.string(), z.number()]).nullish(),
    timezone: z.string().nullish(),
    languages: z.array(z.string()).nullish(),
    // Chỉ lấy định danh proxy; đối tượng `proxy` (có thể kèm thông tin đăng nhập) BỊ BỎ (SPEC-01 §2, Constitution IV)
    proxy_id: z.string().nullish(),
    running: z.boolean().optional(),
    // MachineOverrides (shared-rs/src/overrides.rs): chỉ đọc trường cần cho kiểm nhất quán
    overrides: z
      .object({
        geolocation: z.object({ latitude: z.number(), longitude: z.number() }).nullish(),
        screen: z.object({ width: z.number().int(), height: z.number().int() }).passthrough().nullish(),
        gpu: z.string().nullish(),
        cores: z.number().int().nullish(),
        memory_gb: z.number().nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();
type RawProfileT = z.infer<typeof RawProfile>;

const RawProfiles = envelope(z.array(RawProfile));

const RawPersona = z
  .object({ id: z.string(), os: z.string().nullish(), gpu: z.string().nullish(), screen: z.string().nullish() })
  .passthrough();

const RawLaunch = z
  .object({ pid: z.number().int().optional(), ws_endpoint: z.string().min(1).optional() })
  .passthrough();

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

function toSummary(raw: RawProfileT): FuryProfileSummary {
  const out: FuryProfileSummary = { id: raw.id, name: raw.name, tags: raw.tags ?? [] };
  if (raw.persona_id) {
    out.personaId = raw.persona_id;
    const f = osFamilyOf(raw.persona_id);
    if (f !== undefined) out.osFamily = f;
  }
  return out;
}

function toDetail(raw: RawProfileT): FuryProfileDetail {
  const out: FuryProfileDetail = toSummary(raw);
  if (raw.fp_seed !== undefined && raw.fp_seed !== null) out.seed = String(raw.fp_seed);
  // null = theo quốc gia exit của proxy (Fury tự suy) → để trống, không đoán
  if (raw.timezone) out.timezone = raw.timezone;
  if (raw.languages && raw.languages.length > 0) out.languages = raw.languages;
  if (raw.proxy_id) out.proxyRef = raw.proxy_id;
  // Không có override → Fury đặt geolocation theo quốc gia exit của proxy
  const geo = raw.overrides?.geolocation;
  out.geolocation = geo ? { mode: 'manual', lat: geo.latitude, lon: geo.longitude } : { mode: 'auto' };
  // Override màn hình/GPU thắng giá trị của persona trong danh mục (HttpFuryClient.getProfile ghép sau)
  const ov = raw.overrides;
  if (ov?.screen || ov?.gpu || ov?.cores || ov?.memory_gb) {
    out.persona = { platform: raw.persona_id ?? 'unknown' };
    if (ov.screen) out.persona.screen = { width: ov.screen.width, height: ov.screen.height };
    if (ov.gpu) out.persona.gpuRenderer = ov.gpu;
    if (ov.cores) out.persona.hardwareConcurrency = ov.cores;
    if (ov.memory_gb) out.persona.deviceMemory = ov.memory_gb;
  }
  return out;
}

/** `"1920×1080"` → `{ width, height }`. */
export function parseScreen(s: string | null | undefined): { width: number; height: number } | undefined {
  const m = /(\d+)\s*[×xX*]\s*(\d+)/.exec(s ?? '');
  return m ? { width: Number(m[1]), height: Number(m[2]) } : undefined;
}

function profileIdOf(ctx: ParseContext): string {
  return (ctx.params as { profileId?: string } | undefined)?.profileId ?? '';
}

function findProfile(cap: 'getProfile' | 'getStatus', raw: unknown, ctx: ParseContext): RawProfileT {
  const id = profileIdOf(ctx);
  const p = parseWith(cap, RawProfiles, raw).data.find((x) => x.id === id);
  if (!p) throw profileNotFound(id);
  return p;
}

/** Chuẩn hóa kết quả kiểm exit (dùng khi có nguồn checkExit — TODO(SPIKE-P5)). */
export function parseExitInfo(raw: unknown, ctx: ParseContext): ExitInfo {
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
}

/** Bộ ánh xạ mặc định — đã xác minh với Fury 0.3.22 (SPIKE-P2). */
export const DEFAULT_ENDPOINT_MAP: FuryEndpointMap = {
  health: {
    source: 'native',
    method: 'GET',
    path: () => '/v1/status',
    parse: (raw) => ({ version: parseWith('health', envelope(RawStatus), raw).data.version }),
  },
  listProfiles: {
    source: 'native',
    method: 'GET',
    path: () => '/v1/profiles',
    parse: (raw) => parseWith('listProfiles', RawProfiles, raw).data.map(toSummary),
  },
  getProfile: {
    // Không có endpoint một profile: lấy từ danh sách
    source: 'fallback',
    method: 'GET',
    path: () => '/v1/profiles',
    parse: (raw, ctx) => toDetail(findProfile('getProfile', raw, ctx)),
  },
  getStatus: {
    // `running` trong danh sách, do agent theo dõi tiến trình; không biết mở qua app hay API
    source: 'fallback',
    method: 'GET',
    path: () => '/v1/profiles',
    parse: (raw, ctx) => ({ open: findProfile('getStatus', raw, ctx).running === true, via: 'unknown' }),
  },
  launch: {
    source: 'native',
    method: 'POST',
    path: () => '/v1/profiles/start',
    body: ({ profileId, cdp }) => ({ id: profileId, cdp }),
    parse: (raw) => {
      const l = parseWith('launch', envelope(RawLaunch), raw).data;
      // Team server có thể cấm CDP theo vai trò: trình duyệt vẫn mở nhưng không có ws_endpoint
      if (!l.ws_endpoint) throw new PvError('FURY_CAPABILITY_MISSING', 'Fury mở profile nhưng không cấp CDP (team server có thể cấm theo vai trò)', { capability: 'launch', reason: 'cdp_not_granted' });
      return { cdpEndpoint: l.ws_endpoint, sessionRef: l.pid !== undefined ? String(l.pid) : '' };
    },
  },
  stop: {
    source: 'native',
    method: 'POST',
    path: () => '/v1/profiles/stop',
    body: ({ profileId }) => ({ id: profileId }),
    parse: () => undefined,
  },
  // TODO(SPIKE-P5): API công khai không có kiểm exit proxy (app dùng IPC riêng). Chờ P5 chọn nguồn khác.
  checkExit: { source: 'missing' },
  personas: {
    source: 'native',
    method: 'GET',
    path: () => '/v1/personas',
    parse: (raw) =>
      parseWith('personas', envelope(z.array(RawPersona)), raw).data.map((p) => {
        const out: FuryPersonaInfo = { id: p.id };
        if (p.os) out.os = p.os;
        if (p.gpu) out.gpu = p.gpu;
        const screen = parseScreen(p.screen);
        if (screen) out.screen = screen;
        return out;
      }),
  },
  meta: {
    seed: 'native',
    asnType: 'missing',
    normalizeJson: quoteBigSeeds,
  },
};
