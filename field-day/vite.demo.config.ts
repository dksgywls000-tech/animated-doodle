import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// 실제 앱의 api·realtime 모듈을 브라우저 데모용으로 바꿔 끼운다
const swap = (): Plugin => ({
  name: 'demo-swap',
  enforce: 'pre',
  async resolveId(source, importer) {
    if (!importer || !importer.includes('/client/src/')) return null;
    if (/(^|\/)api$/.test(source)) return resolve(import.meta.dirname, 'client/demo/api.ts');
    if (/(^|\/)realtime$/.test(source)) return resolve(import.meta.dirname, 'client/demo/realtime.ts');
    return null;
  },
});

export default defineConfig({
  root: 'client/demo',
  base: './',
  publicDir: false,
  plugins: [swap(), react()],
  build: {
    outDir: '../../dist/demo',
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
