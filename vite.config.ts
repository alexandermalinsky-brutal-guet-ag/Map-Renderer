import { defineConfig } from 'vite';
import cesium from 'vite-plugin-cesium';
import { resolve } from 'path';
import { existsSync } from 'fs';

const internalDir = resolve(__dirname, 'src/internal');
const stubsDir = resolve(__dirname, 'src/internal-stubs');
const internalAlias = existsSync(resolve(internalDir, 'index.ts')) ? internalDir : stubsDir;

console.log(`[vite] @internal → ${internalAlias === internalDir ? 'src/internal (full)' : 'src/internal-stubs (no-op)'}`);

export default defineConfig({
  plugins: [cesium()],
  resolve: {
    alias: {
      '@internal': internalAlias,
    },
  },
  server: { port: 5173, host: true },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        cesium: resolve(__dirname, 'cesium.html'),
      },
    },
  },
});
