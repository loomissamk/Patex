import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  root: 'src/client',
  build: { outDir: '../../dist/client', emptyOutDir: true },
  server: { port: 5173, proxy: Object.fromEntries(['/api', '/auth', '/mcp'].map(route => [route, { target: process.env.PATEX_DEV_API || 'http://127.0.0.1:3000', changeOrigin: false }])) },
});
