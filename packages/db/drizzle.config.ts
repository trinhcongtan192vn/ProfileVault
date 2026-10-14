import { defineConfig } from 'drizzle-kit';

// Chỉ dùng để sinh SQL tham khảo (`pnpm drizzle:generate`); migration chính thức nằm ở ./migrations
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema.ts',
  out: './drizzle-generated',
});
