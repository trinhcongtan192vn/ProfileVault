import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'gateway', include: ['test/**/*.test.ts'], testTimeout: 20_000 },
});
