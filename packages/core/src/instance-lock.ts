import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import path from 'node:path';
import { PvError } from '@sctech/profilevault-contract';

export interface InstanceLock {
  pid: number;
  file: string;
  release(): void;
}

export interface LockOptions {
  pid?: number;
  startedAt?: string;
  /** Tiêm cho test: PID có còn sống không. Mặc định `process.kill(pid, 0)`. */
  pidAlive?: (pid: number) => boolean;
}

export class InstanceAlreadyRunningError extends PvError {
  constructor(file: string, otherPid: number) {
    super('INTERNAL', `ProfileVault đang chạy ở tiến trình ${otherPid} (khóa ${file}). Chỉ một phiên bản được chạy.`, {
      reason: 'instance_already_running',
      file,
      pid: otherPid,
    });
    this.name = 'InstanceAlreadyRunningError';
  }
}

function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // EPERM: tiến trình tồn tại nhưng không có quyền gửi tín hiệu → coi là sống
    return code === 'EPERM';
  }
}

interface LockContent {
  pid: number;
  startedAt: string;
}

function readLock(file: string): LockContent | null {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<LockContent>;
    if (typeof raw.pid === 'number') return { pid: raw.pid, startedAt: String(raw.startedAt ?? '') };
    return null;
  } catch {
    return null;
  }
}

/**
 * Khóa một phiên bản (SPEC-00 §11): tạo `service.lock` độc quyền; nếu đã có và PID còn sống → ném
 * `InstanceAlreadyRunningError`; PID chết hoặc file hỏng → coi hết hạn, chiếm lại (giả định G2).
 */
export function acquireInstanceLock(file: string, opts: LockOptions = {}): InstanceLock {
  const pid = opts.pid ?? process.pid;
  const pidAlive = opts.pidAlive ?? defaultPidAlive;
  const startedAt = opts.startedAt ?? new Date().toISOString();
  mkdirSync(path.dirname(file), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, 'wx');
      writeSync(fd, JSON.stringify({ pid, startedAt }));
      closeSync(fd);
      let released = false;
      return {
        pid,
        file,
        release() {
          if (released) return;
          released = true;
          const current = readLock(file);
          if (current && current.pid === pid) rmSync(file, { force: true });
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const existing = readLock(file);
      if (existing && existing.pid !== pid && pidAlive(existing.pid)) {
        throw new InstanceAlreadyRunningError(file, existing.pid);
      }
      // hết hạn (PID chết, file hỏng, hoặc chính mình) → xóa và thử lại
      if (existsSync(file)) rmSync(file, { force: true });
    }
  }
  throw new PvError('INTERNAL', `Không chiếm được khóa ${file}`, { reason: 'lock_unavailable', file });
}
