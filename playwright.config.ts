import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/fixtures', timeout: 30_000, workers: 2, use: { headless: true }, reporter: 'list' });
