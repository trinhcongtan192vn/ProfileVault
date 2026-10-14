import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { newId, PvError, type Clock, type ProbeResult } from '@sctech/profilevault-contract';
import type { ProbeResultsRepo } from '@sctech/profilevault-db';
import type { ProbeConverter } from './converters.js';
import { parseFuryCapture } from './normalize.js';

export interface ProbeImportDeps {
  repo: ProbeResultsRepo;
  clock: Clock;
  probesDir: string;
  converters?: ProbeConverter[];
  /** Phiên bản Fury hiện tại (file probe của Fury không ghi phiên bản). */
  furyVersion?: () => string | undefined;
}

export type ProbeSource = { filePath: string } | { raw: object };

/** Chuẩn hóa + lưu file gốc `probes/<probeId>.json` + ghi `probe_results` (SPEC-02 §6.3). Không chạy kiểm — service làm. */
export function importProbeFile(d: ProbeImportDeps, bindingId: string, from: ProbeSource, source: 'manual_import' | 'flow'): ProbeResult {
  let raw: unknown;
  let rawText: string | undefined;
  if ('filePath' in from) {
    if (!existsSync(from.filePath)) throw new PvError('FILE_NOT_FOUND', `Không thấy file probe ${from.filePath}`, { filePath: from.filePath });
    rawText = readFileSync(from.filePath, 'utf8');
    try {
      raw = JSON.parse(rawText);
    } catch {
      throw new PvError('INPUT_INVALID', 'File probe không phải JSON', { filePath: from.filePath });
    }
  } else {
    raw = from.raw;
  }
  const now = d.clock.nowIso();
  const furyVersion = d.furyVersion?.();
  const { probe } = parseFuryCapture(raw, { now, converters: d.converters, ...(furyVersion ? { furyVersion } : {}) });
  const id = newId('probe', d.clock.nowMs());
  mkdirSync(d.probesDir, { recursive: true });
  const rawPath = path.join(d.probesDir, `${id}.json`);
  if ('filePath' in from) copyFileSync(from.filePath, rawPath);
  else writeFileSync(rawPath, rawText ?? JSON.stringify(raw, null, 2), 'utf8');
  const result: ProbeResult = { id, bindingId, furyVersion: probe.furyVersion, source, capturedAt: probe.capturedAt, data: probe, rawPath, createdAt: now };
  d.repo.insert(result);
  return result;
}
