import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      lib: { entry: 'src/main/index.ts' },
      rollupOptions: {
        external: [
          'electron',
          'electron-store',
          // P3C: file.search text extractors. Bundling these would inline
          // pdfjs-dist, which probes `DOMMatrix` at module-load time and
          // crashes the main process before `app.whenReady()` runs (the
          // optional `@napi-rs/canvas` polyfill is not installed). Loading
          // them as runtime `require()` keeps init side-effects deferred
          // and lets each parser surface its own optional-dep warnings as
          // graceful per-call failures.
          'pdf-parse',
          'mammoth',
          'word-extractor',
          'node-html-parser',
          'rtf-parser',
          // P3E: native SQLite binding — must not be bundled by Rollup;
          // asarUnpack '**/*.node' ensures the .node file is accessible
          // at runtime outside the asar archive.
          'better-sqlite3',
        ],
      },
    },
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@shared': resolve('src/shared'),
      },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      lib: {
        entry: 'src/preload/index.ts',
        // Electron's sandboxed preload requires CommonJS — sandbox + ESM
        // preload is not supported. Emit `.cjs` so window.ts can load it
        // unambiguously.
        formats: ['cjs'],
        fileName: () => 'index.cjs',
      },
      rollupOptions: { external: ['electron'] },
    },
    resolve: {
      alias: { '@shared': resolve('src/shared') },
    },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') },
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared'),
      },
    },
  },
});
