import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'fury-client', include: ['test/**/*.test.ts'], testTimeout: 10_000 },
});
