import { z } from 'zod';

/** `config.json` (SPEC-00 §5). Mọi khóa có mặc định; file chỉ cần ghi phần muốn đổi. */
export const ConfigSchema = z.object({
  gateway: z
    .object({
      host: z.string().default('127.0.0.1'),
      /** 0 = hệ điều hành chọn cổng (chỉ dùng cho dev/test). */
      port: z.number().int().min(0).max(65535).default(50410),
    })
    .default({ host: '127.0.0.1', port: 50410 }),
  fury: z
    .object({
      apiBaseUrl: z.string().default('http://127.0.0.1:${FURY_API_PORT}'),
      supportedVersions: z.string().default('>=0.2.21 <0.4.0'),
      dataDir: z.string().nullable().default(null),
    })
    .default({ apiBaseUrl: 'http://127.0.0.1:${FURY_API_PORT}', supportedVersions: '>=0.2.21 <0.4.0', dataDir: null }),
  runner: z
    .object({
      maxConcurrentIdle: z.number().int().min(0).default(6),
      maxConcurrentBusy: z.number().int().min(0).default(3),
      ramPerProfileMb: z.number().int().min(1).default(500),
      profileBusyTimeoutMinutes: z.number().int().min(1).default(360),
      humanGateTimeoutHours: z.number().int().min(1).default(24),
    })
    .default({
      maxConcurrentIdle: 6,
      maxConcurrentBusy: 3,
      ramPerProfileMb: 500,
      profileBusyTimeoutMinutes: 360,
      humanGateTimeoutHours: 24,
    }),
  limits: z
    .object({
      uploadsPerAccountPerDay: z.number().int().min(1).default(10),
    })
    .default({ uploadsPerAccountPerDay: 10 }),
  retention: z
    .object({
      runArtifactsDays: z.number().int().min(1).default(30),
      dataMonths: z.number().int().min(1).default(12),
    })
    .default({ runArtifactsDays: 30, dataMonths: 12 }),
  ui: z
    .object({
      timezone: z.string().default('Asia/Bangkok'),
      dailyReminderLocalTime: z.string().regex(/^\d{2}:\d{2}$/).default('21:00'),
    })
    .default({ timezone: 'Asia/Bangkok', dailyReminderLocalTime: '21:00' }),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ConfigInput = z.input<typeof ConfigSchema>;

export const DEFAULT_CONFIG: Config = ConfigSchema.parse({});

/** Thay `${TÊN}` bằng biến môi trường; thiếu → giữ nguyên và báo trong `missing`. */
export function expandEnv(input: string, env: Record<string, string | undefined>): { value: string; missing: string[] } {
  const missing: string[] = [];
  const value = input.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name: string) => {
    const v = env[name];
    if (v === undefined) {
      missing.push(name);
      return whole;
    }
    return v;
  });
  return { value, missing };
}
