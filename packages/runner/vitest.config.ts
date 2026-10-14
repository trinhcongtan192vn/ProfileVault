import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'profilevault-runner', include: ['test/**/*.test.ts'], passWithNoTests: true },
});
