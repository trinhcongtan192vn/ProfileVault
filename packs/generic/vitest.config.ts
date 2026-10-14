import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'profilevault-pack-generic', include: ['test/**/*.test.ts'], passWithNoTests: true },
});
