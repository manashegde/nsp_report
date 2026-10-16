/// <reference types="vitest/config" />
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: {
        index: resolve(import.meta.dirname, 'src/index.ts'),
        core: resolve(import.meta.dirname, 'src/core/index.ts'),
      },
      formats: ['es', 'cjs'],
      cssFileName: 'easy-report',
    },
    sourcemap: true,
    rolldownOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'jspdf'],
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
  },
});
