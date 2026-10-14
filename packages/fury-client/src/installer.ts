import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { Clock, FuryInstallStatus, FuryReleaseFile, FuryReleasePin } from '@sctech/profilevault-contract';
import type { Logger } from '@sctech/profilevault-core';

/**
 * Bản Fury đã ghim (SPEC-00 §11.1). Giá trị lấy từ `SHA256SUMS` của release chính thức
 * github.com/furyteamtop/fury-antidetect-browser, đã đối chiếu digest GitHub (2026-10-14).
 * Nâng bản: đổi cả ba trường + kiểm `config.fury.supportedVersions`.
 */
export const FURY_RELEASE_PIN: FuryReleasePin = {
  version: '0.3.22',
  setup: {
    url: 'https://github.com/furyteamtop/fury-antidetect-browser/releases/download/v0.3.22/fury-0.3.22-windows-x64-setup.exe',
    sha256: '9b5d31ed7c5ab401006a2c4014eb84947cbb550811f997d128face3af69c60a5',
    size: 9593154,
  },
  core: {
    url: 'https://github.com/furyteamtop/fury-antidetect-browser/releases/download/v0.3.22/fury-core-0.3.22-windows-x64.tar.xz',
    sha256: '498b4e995eae898a2a5cfe1525b9bae9c8b2781b87920032860f536a2309f9ec',
    size: 147976812,
  },
};

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}
export type InstallerExec = (file: string, args: string[], timeoutMs: number) => Promise<ExecResult>;

/** Chạy tiến trình, không ném; lỗi khởi chạy → `code: null`. */
export const defaultInstallerExec: InstallerExec = (file, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const raw = (err as { code?: unknown } | null)?.code;
      const code = err ? (typeof raw === 'number' ? raw : null) : 0;
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });

export interface FuryInstallerOptions {
  /** `%LOCALAPPDATA%` của người dùng Windows (bộ cài NSIS của Fury cài vào `<đây>\Fury`). */
  localAppData: string;
  /** Thư mục tải tạm (xóa file sau khi cài xong). */
  downloadsDir: string;
  clock: Clock;
  pin?: FuryReleasePin;
  platform?: NodeJS.Platform;
  fetch?: typeof fetch;
  exec?: InstallerExec;
  logger?: Logger;
  onStatus?: (status: FuryInstallStatus) => void;
}

const SETUP_TIMEOUT_MS = 10 * 60_000;
const CORE_TIMEOUT_MS = 10 * 60_000;
const PROBE_TIMEOUT_MS = 30_000;
const PROGRESS_STEP_BYTES = 4 * 1024 * 1024;

/** Dòng `fury-agent 0.3.22` ở đầu `fury-agent --help` (đã xác minh trên 0.3.22). */
export function parseAgentVersion(output: string): string | null {
  return /^fury-agent\s+(\d+\.\d+\.\d+\S*)/m.exec(output)?.[1] ?? null;
}

/** `fury-agent install-core [file]` in `installed X` hoặc `X` + đường dẫn (đã xác minh trên 0.3.22). */
export function parseCoreVersion(output: string): string | null {
  return /^\s*(?:installed\s+)?(\d+\.\d+\.\d+\.\d+)\s*$/m.exec(output)?.[1] ?? null;
}

/**
 * Tự cài Fury khi máy chưa có: tải bộ cài + core từ release đã ghim, kiểm SHA-256 và kích thước,
 * chạy bộ cài NSIS im lặng (per-user, không cần admin), rồi `fury-agent install-core`.
 * Không bao giờ gỡ, hạ bản hay ghi đè Fury đã có; không mở profile, không đọc dữ liệu Fury.
 */
export class FuryInstaller {
  private readonly pin: FuryReleasePin;
  private readonly platform: NodeJS.Platform;
  private readonly fetchFn: typeof fetch;
  private readonly exec: InstallerExec;
  /** Nhận mỗi lần trạng thái đổi (gán lại được sau khi tạo). */
  onStatus: ((status: FuryInstallStatus) => void) | undefined;
  private current: FuryInstallStatus;
  private running: Promise<FuryInstallStatus> | null = null;

  constructor(private readonly opts: FuryInstallerOptions) {
    this.pin = opts.pin ?? FURY_RELEASE_PIN;
    this.platform = opts.platform ?? process.platform;
    this.fetchFn = opts.fetch ?? fetch;
    this.exec = opts.exec ?? defaultInstallerExec;
    this.onStatus = opts.onStatus;
    this.current = this.make('idle');
  }

  get installDir(): string {
    return path.join(this.opts.localAppData, 'Fury');
  }

  get agentPath(): string {
    return path.join(this.installDir, 'fury-agent.exe');
  }

  status(): FuryInstallStatus {
    return this.current;
  }

  /** Đặt trạng thái `disabled` (config `fury.autoInstall = false`). */
  disable(): void {
    this.set(this.make('disabled'));
  }

  /** Kiểm và cài phần còn thiếu. Gọi lại khi đang chạy → trả cùng một lần chạy. */
  ensure(): Promise<FuryInstallStatus> {
    this.running ??= this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(): Promise<FuryInstallStatus> {
    if (this.platform !== 'win32') {
      this.set(this.make('unsupported', { error: 'Tự cài Fury chỉ hỗ trợ Windows.' }));
      return this.current;
    }
    try {
      this.set(this.make('checking'));
      if (!existsSync(this.agentPath)) {
        const setup = await this.download('app', this.pin.setup);
        this.set(this.make('installing', { step: 'app' }));
        const r = await this.exec(setup, ['/S'], SETUP_TIMEOUT_MS);
        if (r.code !== 0 || !existsSync(this.agentPath)) {
          throw new Error(`Bộ cài Fury kết thúc với mã ${String(r.code)} và không tạo ${this.agentPath}.`);
        }
        rmSync(setup, { force: true });
        this.opts.logger?.info('đã cài app Fury', { version: this.pin.version, dir: this.installDir });
      }
      const appVersion = parseAgentVersion(await this.probe(['--help']));
      let coreVersion = parseCoreVersion(await this.probe(['install-core']));
      if (!coreVersion) {
        const core = await this.download('core', this.pin.core, appVersion);
        this.set(this.make('installing', { step: 'core', appVersion }));
        const r = await this.exec(this.agentPath, ['install-core', core], CORE_TIMEOUT_MS);
        coreVersion = parseCoreVersion(`${r.stdout}\n${r.stderr}`);
        if (r.code !== 0 || !coreVersion) {
          throw new Error(`Cài core Fury thất bại (mã ${String(r.code)}): ${lastLine(r.stderr || r.stdout)}`);
        }
        rmSync(core, { force: true });
        this.opts.logger?.info('đã cài core Fury', { coreVersion });
      }
      this.set(this.make('ready', { appVersion, coreVersion }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.logger?.warn('tự cài Fury thất bại', { error: message });
      this.set(this.make('failed', { error: message, appVersion: this.current.appVersion, coreVersion: this.current.coreVersion }));
    }
    return this.current;
  }

  private async probe(args: string[]): Promise<string> {
    const r = await this.exec(this.agentPath, args, PROBE_TIMEOUT_MS);
    return `${r.stdout}\n${r.stderr}`;
  }

  /** Tải về `downloadsDir`, kiểm kích thước + SHA-256; file đã có và khớp thì dùng lại. */
  private async download(step: 'app' | 'core', file: FuryReleaseFile, appVersion: string | null = null): Promise<string> {
    mkdirSync(this.opts.downloadsDir, { recursive: true });
    const target = path.join(this.opts.downloadsDir, path.basename(new URL(file.url).pathname));
    if (existsSync(target) && (await sha256File(target)) === file.sha256) return target;
    rmSync(target, { force: true });

    this.set(this.make('downloading', { step, appVersion, progress: { received: 0, total: file.size } }));
    const res = await this.fetchFn(file.url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`Tải ${path.basename(target)} thất bại: HTTP ${res.status}.`);

    const part = `${target}.part`;
    const hash = createHash('sha256');
    let received = 0;
    let reported = 0;
    const meter = new Transform({
      transform: (chunk: Buffer, _enc, cb) => {
        hash.update(chunk);
        received += chunk.length;
        if (received - reported >= PROGRESS_STEP_BYTES) {
          reported = received;
          this.set(this.make('downloading', { step, appVersion, progress: { received, total: file.size } }));
        }
        cb(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>), meter, createWriteStream(part));
    } catch (err) {
      rmSync(part, { force: true });
      throw err;
    }
    const digest = hash.digest('hex');
    if (received !== file.size || digest !== file.sha256) {
      rmSync(part, { force: true });
      throw new Error(`File ${path.basename(target)} không khớp bản phát hành (kích thước ${received}/${file.size}, SHA-256 ${digest.slice(0, 12)}…). Đã xóa, không cài.`);
    }
    renameSync(part, target);
    return target;
  }

  private make(state: FuryInstallStatus['state'], extra: Partial<FuryInstallStatus> = {}): FuryInstallStatus {
    return {
      state,
      step: null,
      pinnedVersion: this.pin.version,
      appVersion: null,
      coreVersion: null,
      progress: null,
      error: null,
      updatedAt: this.opts.clock.nowIso(),
      ...extra,
    };
  }

  private set(status: FuryInstallStatus): void {
    this.current = status;
    this.onStatus?.(status);
  }
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

function lastLine(text: string): string {
  return text.trim().split(/\r?\n/).at(-1)?.slice(0, 300) ?? '';
}
