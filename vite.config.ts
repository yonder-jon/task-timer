import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The client lives in src/client; `npm run build` writes to dist/client, which the server serves.
// In development (`npm run dev`) Vite serves the client and forwards /api to the Node server.
export default defineConfig({
  root: 'src/client',
  plugins: [react()],
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    chunkSizeWarningLimit: 800, // Mantine + React; fine for a local app
  },
  server: {
    port: 5173,
    allowedHosts: ['.ts.net'], // reachable through `tailscale serve`
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
});
