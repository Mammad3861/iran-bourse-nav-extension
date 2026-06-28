import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const distDir = resolve(projectRoot, 'dist');

const sharedOutput = {
  entryFileNames: '[name].js',
  chunkFileNames: 'chunks/[name]-[hash].js',
  assetFileNames: 'assets/[name]-[hash][extname]'
};

async function buildAppShell() {
  await build({
    configFile: false,
    publicDir: false,
    build: {
      outDir: distDir,
      emptyOutDir: false,
      sourcemap: true,
      rollupOptions: {
        input: {
          'background/service-worker': resolve(projectRoot, 'src/background/service-worker.ts'),
          'popup/popup': resolve(projectRoot, 'src/popup/popup.html')
        },
        output: sharedOutput
      }
    }
  });
}

async function buildContentScript(entry, fileName, globalName) {
  await build({
    configFile: false,
    publicDir: false,
    build: {
      outDir: distDir,
      emptyOutDir: false,
      sourcemap: true,
      cssCodeSplit: false,
      lib: {
        entry: resolve(projectRoot, entry),
        name: globalName,
        formats: ['iife'],
        fileName: () => fileName
      },
      rollupOptions: {}
    }
  });
}

async function copyExtensionAssets() {
  await mkdir(resolve(distDir, 'icons'), { recursive: true });
  await copyFile(resolve(projectRoot, 'manifest.json'), resolve(distDir, 'manifest.json'));
  await copyFile(resolve(projectRoot, 'public/icons/icon.svg'), resolve(distDir, 'icons/icon.svg'));
}

async function normalizePopupHtmlPath() {
  const sourcePopup = resolve(distDir, 'src/popup/popup.html');
  const targetPopup = resolve(distDir, 'popup/popup.html');

  await mkdir(resolve(distDir, 'popup'), { recursive: true });
  await rename(sourcePopup, targetPopup);
  await rm(resolve(distDir, 'src'), { recursive: true, force: true });
}

await rm(distDir, { recursive: true, force: true });
await buildAppShell();
await normalizePopupHtmlPath();
await buildContentScript('src/content/tsetmc-content.ts', 'content/tsetmc-content.js', 'IranBourseTsetmcContent');
await buildContentScript('src/content/codal-content.ts', 'content/codal-content.js', 'IranBourseCodalContent');
await copyExtensionAssets();

const manifestPath = resolve(distDir, 'manifest.json');
const manifest = JSON.parse((await readFile(manifestPath, 'utf8')).replace(/^\uFEFF/, ''));
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
