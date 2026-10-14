import { DEFAULT_THRESHOLDS } from '@sctech/profilevault-contract';
import type { Seeder } from '@sctech/profilevault-core';

export const THRESHOLDS_SETTING = 'thresholds';

/** Seed ngưỡng mặc định SPEC-02 §3.3 lần chạy đầu (SPEC-00 §11). */
export const thresholdsSeeder: Seeder = (ctx) => {
  if (!ctx.settings.has(THRESHOLDS_SETTING)) ctx.settings.set(THRESHOLDS_SETTING, DEFAULT_THRESHOLDS, 'system');
};
