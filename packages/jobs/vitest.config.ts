import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'profilevault-jobs', include: ['test/**/*.test.ts'], passWithNoTests: true },
});
