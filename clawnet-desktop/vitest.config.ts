import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    coverage: { reporter: ['text', 'lcov'], include: ['src/**/*.{ts,tsx}'] },
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    server: {
      deps: {
        inline: ['electron-store', 'conf'],
      },
    },
  },
  resolve: {
    alias: {
      '@main': resolve('src/main'),
      '@renderer': resolve('src/renderer'),
      '@shared': resolve('src/shared'),
    },
  },
});
