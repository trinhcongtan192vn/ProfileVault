import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { systemClock, type Clock } from '@sctech/profilevault-contract';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
  /** Dọn file cũ (gọi tự động khi tạo và khi đổi ngày). */
  rotate(): void;
  close(): void;
}

export interface LoggerOptions {
  /** Thư mục log; `null` → chỉ ghi `sink` (test) hoặc bỏ qua. */
  dir: string | null;
  clock?: Clock;
  level?: LogLevel;
  /** Trả về danh sách giá trị bí mật cần che. */
  redact?: () => string[];
  retentionDays?: number;
  /** Nhận từng dòng (test / stdout). */
  sink?: (line: string) => void;
  filePrefix?: string;
}

const FILE_RE = /^(?<prefix>[a-z-]+)-(?<date>\d{4}-\d{2}-\d{2})\.log$/;

function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Log NDJSON theo ngày `logs/service-YYYY-MM-DD.log`, xoay vòng 7 ngày (SPEC-00 §5),
 * che mọi giá trị bí mật trước khi ghi (giả định G6).
 */
export function createLogger(opts: LoggerOptions): Logger {
  const clock = opts.clock ?? systemClock;
  const minRank = LEVEL_RANK[opts.level ?? 'info'];
  const retentionDays = opts.retentionDays ?? 7;
  const prefix = opts.filePrefix ?? 'service';
  const dir = opts.dir;
  if (dir) mkdirSync(dir, { recursive: true });
  let lastDay = '';
  let closed = false;

  function rotate(): void {
    if (!dir) return;
    const today = dayOf(clock.nowIso());
    const cutoff = new Date(clock.nowMs() - (retentionDays - 1) * 86_400_000).toISOString().slice(0, 10);
    for (const entry of readdirSync(dir)) {
      const m = FILE_RE.exec(entry);
      if (!m?.groups) continue;
      if (m.groups.prefix !== prefix) continue;
      const date = m.groups.date ?? '';
      if (date < cutoff) rmSync(path.join(dir, entry), { force: true });
    }
    lastDay = today;
  }

  function redactString(s: string): string {
    const secrets = opts.redact?.() ?? [];
    let out = s;
    for (const v of secrets) {
      if (v.length === 0) continue;
      out = out.split(v).join('***');
    }
    return out;
  }

  function write(level: LogLevel, msg: string, data: Record<string, unknown> | undefined, bindings: Record<string, unknown>): void {
    if (closed || LEVEL_RANK[level] < minRank) return;
    const ts = clock.nowIso();
    const record = { ts, level, msg, ...bindings, ...(data ?? {}) };
    let line: string;
    try {
      line = JSON.stringify(record);
    } catch {
      line = JSON.stringify({ ts, level, msg, ...bindings, data: '[không serialize được]' });
    }
    line = redactString(line);
    opts.sink?.(line);
    if (dir) {
      const day = dayOf(ts);
      if (day !== lastDay) rotate();
      appendFileSync(path.join(dir, `${prefix}-${day}.log`), line + '\n', 'utf8');
    }
  }

  function make(bindings: Record<string, unknown>): Logger {
    return {
      debug: (m, d) => write('debug', m, d, bindings),
      info: (m, d) => write('info', m, d, bindings),
      warn: (m, d) => write('warn', m, d, bindings),
      error: (m, d) => write('error', m, d, bindings),
      child: (more) => make({ ...bindings, ...more }),
      rotate,
      close: () => {
        closed = true;
      },
    };
  }

  rotate();
  return make({});
}

/** Logger bỏ qua mọi thứ (test). */
export const silentLogger: Logger = createLogger({ dir: null, level: 'error', sink: () => undefined });
