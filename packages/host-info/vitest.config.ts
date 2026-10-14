import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'host-info', include: ['test/**/*.test.ts'], testTimeout: 15_000 },
});
