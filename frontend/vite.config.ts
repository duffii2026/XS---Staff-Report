import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  const apiTarget = 'http://localhost:5812';
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    envDir: '.',
    envPrefix: 'VITE_',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: path.resolve(__dirname, 'index.html'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      port: 3555,
      allowedHosts: [
        'localhost',
        'apa2-eva.com',
        'staff.apa2-eva.com',
        'staff-report.apa2-eva.com',
      ],
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (_proxyReq, req) => {
              console.log(`[proxy] ${req.method} ${req.url} → ${apiTarget}${req.url}`);
            });
          },
        },
      },
    },
  };
});
