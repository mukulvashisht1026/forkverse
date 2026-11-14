import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  // TRACEWIRE backend (Express + WebSocket). Override with BACKEND_URL in frontend/.env.
  const backend = loadEnv(mode, process.cwd(), '').BACKEND_URL || 'http://localhost:3000';
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 5173,
      // Same routing as Caddy in prod: /api/* -> backend with the prefix stripped, /ws -> backend.
      proxy: {
        '/api': {
          target: backend,
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/api/, ''),
        },
        '/ws': {target: backend, ws: true, changeOrigin: true},
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
