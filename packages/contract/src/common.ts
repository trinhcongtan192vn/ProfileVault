import { z } from 'zod';

/** Thời gian UTC ISO 8601 (SPEC-00 §2), ví dụ `2026-10-14T10:21:00.000Z`. */
export const IsoDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/, 'phải là ISO 8601 UTC (hậu tố Z)');
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

/** Mã quốc gia ISO 3166-1 alpha-2. */
export const CountryCodeSchema = z.string().regex(/^[A-Z]{2}$/, 'mã quốc gia ISO 3166-1 alpha-2');

/** Đối tượng JSON bất kỳ (kiểm nông). */
export const JsonObjectSchema = z.record(z.string(), z.unknown());
export type JsonObject = z.infer<typeof JsonObjectSchema>;
