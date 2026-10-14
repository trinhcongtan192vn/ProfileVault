import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'profilevault-pack-youtube', include: ['test/**/*.test.ts'], passWithNoTests: true },
});
