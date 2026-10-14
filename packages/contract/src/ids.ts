import { randomBytes } from 'node:crypto';
import { z } from 'zod';

/** Tiền tố ID theo thực thể (SPEC-00 §6). */
export const ID_PREFIXES = {
  binding: 'ab',
  levelChange: 'lc',
  pause: 'bp',
  healthEvent: 'he',
  proxyCheck: 'px',
  probe: 'pr',
  consistencyRun: 'cc',
  job: 'jb',
  run: 'rn',
  schedule: 'sc',
  client: 'ca',
  audit: 'au',
} as const;

export type IdPrefixKey = keyof typeof ID_PREFIXES;
export type IdPrefix = (typeof ID_PREFIXES)[IdPrefixKey];

// ---- ULID (tự cài, không phụ thuộc gói ngoài) ----
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32
const TIME_LEN = 10;
const RANDOM_LEN = 16;
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

let lastTime = -1;
let lastRandom: number[] = [];

function encodeTime(now: number): string {
  let t = now;
  let out = '';
  for (let i = 0; i < TIME_LEN; i++) {
    const mod = t % 32;
    out = ENCODING[mod] + out;
    t = (t - mod) / 32;
  }
  return out;
}

function randomDigits(): number[] {
  const bytes = randomBytes(RANDOM_LEN);
  return Array.from(bytes, (b) => b % 32);
}

function incrementDigits(digits: number[]): number[] {
  const out = digits.slice();
  for (let i = out.length - 1; i >= 0; i--) {
    const v = out[i] ?? 0;
    if (v < 31) {
      out[i] = v + 1;
      return out;
    }
    out[i] = 0;
  }
  return out; // tràn: cực hiếm, chấp nhận
}

/** Sinh ULID đơn điệu trong cùng mili giây. `now` tùy chọn cho test. */
export function ulid(now: number = Date.now()): string {
  let digits: number[];
  if (now === lastTime) {
    digits = incrementDigits(lastRandom);
  } else {
    digits = randomDigits();
  }
  lastTime = now;
  lastRandom = digits;
  return encodeTime(now) + digits.map((d) => ENCODING[d]).join('');
}

/** Giải mã phần thời gian (ms) của ULID. */
export function ulidTime(id: string): number {
  let t = 0;
  for (let i = 0; i < TIME_LEN; i++) {
    t = t * 32 + ENCODING.indexOf(id.charAt(i));
  }
  return t;
}

export function isUlid(value: string): boolean {
  return ULID_RE.test(value);
}

/** ID có tiền tố, ví dụ `ab_01J...`. */
export function newId(prefixKey: IdPrefixKey, now?: number): string {
  return `${ID_PREFIXES[prefixKey]}_${ulid(now)}`;
}

export function isIdOf(prefixKey: IdPrefixKey, value: string): boolean {
  const prefix = ID_PREFIXES[prefixKey];
  return value.startsWith(`${prefix}_`) && isUlid(value.slice(prefix.length + 1));
}

export function IdSchema(prefixKey: IdPrefixKey) {
  const prefix = ID_PREFIXES[prefixKey];
  return z.string().refine((v) => isIdOf(prefixKey, v), { message: `ID phải có dạng ${prefix}_<ULID>` });
}

export const BindingIdSchema = IdSchema('binding');
export const LevelChangeIdSchema = IdSchema('levelChange');
export const PauseIdSchema = IdSchema('pause');
export const HealthEventIdSchema = IdSchema('healthEvent');
export const ProxyCheckIdSchema = IdSchema('proxyCheck');
export const ProbeIdSchema = IdSchema('probe');
export const ConsistencyRunIdSchema = IdSchema('consistencyRun');
export const JobIdSchema = IdSchema('job');
export const RunIdSchema = IdSchema('run');
export const ScheduleIdSchema = IdSchema('schedule');
export const ClientIdSchema = IdSchema('client');
export const AuditIdSchema = IdSchema('audit');

/** Flow ID `<pack>/<flow>` (SPEC-00 §6). */
export const FlowIdSchema = z.string().regex(/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/, 'flow id dạng <pack>/<flow>');
export type FlowId = z.infer<typeof FlowIdSchema>;

/** Luật nhất quán `<lớp><số>.<tên>` (SPEC-00 §6). */
export const RuleIdSchema = z.string().regex(/^[A-E]\d+\.[a-z][a-z0-9_]*$/, 'rule id dạng A1.ten_luat');
export type RuleId = z.infer<typeof RuleIdSchema>;
