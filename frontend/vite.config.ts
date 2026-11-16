import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

const APP_PORTS: Record<string, number> = { '1': 3554, '2': 3555, '3': 3556 };
const API_PORTS: Record<string, number> = { '1': 5811, '2': 5812, '3': 5813 };

export default defineConfig(({ mode }) => {
  const app = mode.startsWith('build') ? mode.replace('build', '') : '1';
  const entryHtml = `index${app}.html`;
  const devPort = APP_PORTS[app] ?? 3554;
  const apiPort = API_PORTS[app] ?? 5811;
  const apiTarget = `http://localhost:${apiPort}`;

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
      outDir: app === '1' ? 'dist' : `dist${app}`,
      emptyOutDir: true,
      rollupOptions: {
        input: path.resolve(__dirname, entryHtml),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      port: devPort,
      allowedHosts: [
        'localhost',
        'apa1-eva.com',
        'staff.apa1-eva.com',
        'staff-report.apa1-eva.com',
        'apa2-eva.com',
        'staff.apa2-eva.com',
        'staff-report.apa2-eva.com',
        'staff-report3.apa2-eva.com',
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
