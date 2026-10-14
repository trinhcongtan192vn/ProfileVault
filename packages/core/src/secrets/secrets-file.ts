import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { PvError } from '@sctech/profilevault-contract';

/** Định dạng `secrets.bin`: JSON, mỗi entry là blob DPAPI base64 (giả định G5 trong docs/progress.md). */
export const SecretsFileSchema = z.object({
  version: z.literal(1),
  entries: z.record(z.string(), z.string()),
});
export type SecretsFile = z.infer<typeof SecretsFileSchema>;

export function readSecretsFile(file: string): SecretsFile {
  if (!existsSync(file)) return { version: 1, entries: {} };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new PvError('INTERNAL', 'secrets.bin hỏng (không phải JSON). Xóa file và nhập lại token Fury.', {
      reason: 'secrets_corrupt',
      file,
      cause: err instanceof Error ? err.message : String(err),
    });
  }
  const r = SecretsFileSchema.safeParse(raw);
  if (!r.success) {
    throw new PvError('INTERNAL', 'secrets.bin sai định dạng. Xóa file và nhập lại token Fury.', {
      reason: 'secrets_corrupt',
      file,
    });
  }
  return r.data;
}

/** Ghi nguyên tử: file tạm rồi đổi tên. */
export function writeSecretsFile(file: string, data: SecretsFile): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  renameSync(tmp, file);
}
