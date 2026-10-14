import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Gateway phục vụ dist/ tại `/` (SPEC-05 §3). Dev: proxy /internal và /auth tới dịch vụ đang chạy.
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    proxy: { '/internal': 'http://127.0.0.1:50410', '/auth': 'http://127.0.0.1:50410' },
  },
});
