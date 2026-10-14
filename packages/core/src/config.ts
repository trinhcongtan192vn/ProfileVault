import { existsSync, readFileSync } from 'node:fs';
import { ConfigSchema, expandEnv, PvError, type Config } from '@sctech/profilevault-contract';
import type { Paths } from './paths.js';

export interface LoadConfigResult {
  config: Config;
  /** Biến môi trường được tham chiếu nhưng thiếu (giữ nguyên chuỗi gốc). */
  missingEnv: string[];
  /** File có tồn tại không. */
  fromFile: boolean;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Thay `${TÊN}` trong mọi chuỗi (đệ quy). */
function expandAll(value: unknown, env: NodeJS.ProcessEnv, missing: Set<string>): unknown {
  if (typeof value === 'string') {
    const r = expandEnv(value, env);
    for (const m of r.missing) missing.add(m);
    return r.value;
  }
  if (Array.isArray(value)) return value.map((v) => expandAll(v, env, missing));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = expandAll(v, env, missing);
    return out;
  }
  return value;
}

function describeJsonError(text: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const m = /position (\d+)/.exec(msg);
  if (!m) return msg;
  const pos = Number(m[1]);
  const before = text.slice(0, pos);
  const line = before.split('\n').length;
  const colIdx = before.lastIndexOf('\n');
  const column = pos - (colIdx === -1 ? 0 : colIdx + 1) + 1;
  return `${msg} (dòng ${line}, cột ${column})`;
}

/**
 * Tải `config.json` (SPEC-00 §5): thiếu file → mặc định; JSON hỏng hoặc sai kiểu → `PvError('INPUT_INVALID')`.
 * Không bao giờ ghi đè file.
 */
export function loadConfig(paths: Paths, env: NodeJS.ProcessEnv = process.env): LoadConfigResult {
  let raw: unknown = {};
  const fromFile = existsSync(paths.configFile);
  if (fromFile) {
    const text = readFileSync(paths.configFile, 'utf8');
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new PvError('INPUT_INVALID', `config.json hỏng: ${describeJsonError(text, err)}`, {
        file: paths.configFile,
      });
    }
    if (!isPlainObject(raw)) {
      throw new PvError('INPUT_INVALID', 'config.json phải là một đối tượng JSON', { file: paths.configFile });
    }
  }
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PvError('INPUT_INVALID', 'config.json sai kiểu', {
      file: paths.configFile,
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const missing = new Set<string>();
  const config = expandAll(parsed.data, env, missing) as Config;
  return { config, missingEnv: [...missing], fromFile };
}
