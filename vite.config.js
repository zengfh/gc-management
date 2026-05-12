import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './test/setupTests.js',
    exclude: ['node_modules/**', 'dist/**', 'e2e/**'],
  },
});
