import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'profilevault-fury-client', include: ['test/**/*.test.ts'], passWithNoTests: true },
});
