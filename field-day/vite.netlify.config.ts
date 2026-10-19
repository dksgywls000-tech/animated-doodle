import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// 화면 코드(client/src)의 api·realtime을 Firebase 어댑터로 바꿔 끼운다
const swap = (): Plugin => ({
  name: 'firebase-swap',
  enforce: 'pre',
  resolveId(source, importer) {
    if (!importer || !importer.includes('/client/src/')) return null;
    if (/(^|\/)api$/.test(source)) return resolve(import.meta.dirname, 'client/firebase/api.ts');
    if (/(^|\/)realtime$/.test(source)) return resolve(import.meta.dirname, 'client/firebase/realtime.ts');
    return null;
  },
});

export default defineConfig({
  root: 'client/firebase',
  envDir: resolve(import.meta.dirname),
  publicDir: resolve(import.meta.dirname, 'public'),
  plugins: [swap(), react()],
  build: { outDir: resolve(import.meta.dirname, 'dist/netlify'), emptyOutDir: true, assetsDir: 'bundle', sourcemap: false, chunkSizeWarningLimit: 1500 },
  server: { port: 5174 },
});
