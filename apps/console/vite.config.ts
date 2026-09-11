// 工作台的 Vite 配置：开发期把 /api 与 /auth 代理到本机的 cs-api 与 cs-auth。
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const config = defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/auth': 'http://localhost:8081',
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});

export default config;
