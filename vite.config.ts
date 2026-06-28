import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

const projectRoot = dirname(fileURLToPath(import.meta.url));

function emitExtensionAssets(): Plugin {
  return {
    name: 'emit-extension-assets',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: readFileSync(resolve(projectRoot, 'manifest.json'), 'utf8')
      });
      this.emitFile({
        type: 'asset',
        fileName: 'icons/icon.svg',
        source: readFileSync(resolve(projectRoot, 'public/icons/icon.svg'), 'utf8')
      });
    }
  };
}

export default defineConfig({
  publicDir: false,
  plugins: [emitExtensionAssets()],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        'background/service-worker': resolve(projectRoot, 'src/background/service-worker.ts'),
        'content/tsetmc-content': resolve(projectRoot, 'src/content/tsetmc-content.ts'),
        'content/codal-content': resolve(projectRoot, 'src/content/codal-content.ts'),
        'popup/popup': resolve(projectRoot, 'src/popup/popup.html')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/tests/**/*.test.ts']
  }
});
