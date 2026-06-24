import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, the API + WebSocket run on :8000 (uvicorn). We proxy /api, /ws and
// /reports there so the app can use same-origin relative URLs and avoid CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8000', ws: true },
      '/reports': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
});
