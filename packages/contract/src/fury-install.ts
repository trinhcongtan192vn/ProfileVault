import { z } from 'zod';
import { IsoDateTimeSchema } from './common.js';

/** Tự cài Fury khi máy chưa có (SPEC-00 §11.1). */

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

export const FuryReleaseFileSchema = z.object({
  url: z.url(),
  sha256: Sha256Schema,
  size: z.number().int().positive(),
});
export type FuryReleaseFile = z.infer<typeof FuryReleaseFileSchema>;

/** Bản Fury đã ghim: bộ cài app (NSIS, per-user) + core Chromium. */
export const FuryReleasePinSchema = z.object({
  version: z.string().min(1),
  setup: FuryReleaseFileSchema,
  core: FuryReleaseFileSchema,
});
export type FuryReleasePin = z.infer<typeof FuryReleasePinSchema>;

export const FuryInstallStateSchema = z.enum(['idle', 'checking', 'downloading', 'installing', 'ready', 'failed', 'unsupported', 'disabled']);
export type FuryInstallState = z.infer<typeof FuryInstallStateSchema>;

export const FuryInstallStatusSchema = z.object({
  state: FuryInstallStateSchema,
  /** Bước đang làm khi `downloading`/`installing`. */
  step: z.enum(['app', 'core']).nullable(),
  pinnedVersion: z.string(),
  /** Phiên bản app Fury đã cài (`fury-agent`), `null` khi chưa có. */
  appVersion: z.string().nullable(),
  /** Phiên bản core Chromium đã cài, `null` khi chưa có. */
  coreVersion: z.string().nullable(),
  progress: z.object({ received: z.number().int(), total: z.number().int() }).nullable(),
  error: z.string().nullable(),
  updatedAt: IsoDateTimeSchema,
});
export type FuryInstallStatus = z.infer<typeof FuryInstallStatusSchema>;
