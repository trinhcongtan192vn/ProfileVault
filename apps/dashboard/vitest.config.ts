import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'profilevault-dashboard', include: ['test/**/*.test.ts'], passWithNoTests: true },
});
