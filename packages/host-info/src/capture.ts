import { execFile } from 'node:child_process';
import os from 'node:os';
import type { HostSnapshot } from '@sctech/profilevault-contract';
import { parseScreens, parseVideoControllers } from './parse.js';

export type Exec = (file: string, args: string[], timeoutMs: number) => Promise<string>;

/**
 * Chạy PowerShell không cần quyền admin, trả stdout; lỗi/timeout → ''.
 * Đã xác minh ở SPIKE-P6 (2026-10-14, Windows 10 19045, không cần admin): đủ trường, ~170 ms.
 */
export const defaultExec: Exec = (file, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? '' : String(stdout));
    });
  });

const PS = 'powershell.exe';
const GPU_CMD = 'Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM | ConvertTo-Json -Compress';
const SCREEN_CMD =
  'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | Select-Object Primary, @{n="Bounds";e={@{Width=$_.Bounds.Width;Height=$_.Bounds.Height}}} | ConvertTo-Json -Compress';

export interface CaptureOptions {
  timeoutMs?: number;
  exec?: Exec;
  now?: () => string;
  platform?: NodeJS.Platform;
}

function osFamily(platform: NodeJS.Platform): string {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  return platform;
}

/** Chụp thông tin máy (SPEC-00 §8 host_snapshots). Không ném; phần không đọc được → mảng rỗng. */
export async function captureHostSnapshot(opts: CaptureOptions = {}): Promise<HostSnapshot> {
  const platform = opts.platform ?? process.platform;
  const exec = opts.exec ?? defaultExec;
  const timeoutMs = opts.timeoutMs ?? 3000;
  const base: HostSnapshot = {
    os: osFamily(platform),
    osVersion: os.release(),
    gpus: [],
    displays: [],
    ramMb: Math.round(os.totalmem() / (1024 * 1024)),
    capturedAt: (opts.now ?? (() => new Date().toISOString()))(),
  };
  if (platform !== 'win32') return base;
  const [gpuOut, screenOut] = await Promise.all([
    exec(PS, ['-NoProfile', '-NonInteractive', '-Command', GPU_CMD], timeoutMs),
    exec(PS, ['-NoProfile', '-NonInteractive', '-Command', SCREEN_CMD], timeoutMs),
  ]);
  base.gpus = parseVideoControllers(gpuOut);
  base.displays = parseScreens(screenOut);
  return base;
}
