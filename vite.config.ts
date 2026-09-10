import { defineConfig } from 'vitest/config';

/** 開発中の API サーバ（別ターミナルで `npm run worker:dev`）。 */
const WORKER = process.env.WORKER_URL ?? 'http://localhost:8787';

export default defineConfig({
  server: {
    proxy: {
      // /api は Cloudflare Workers 側に流す。WebSocket もそのまま通す
      '/api': { target: WORKER, changeOrigin: true, ws: true },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
  },
});
