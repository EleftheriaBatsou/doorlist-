import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: 'web',
  plugins: [vue()],
  server: {
    // Served through the Zerops L7 balancer (and later a custom domain).
    allowedHosts: ['.zerops.app', 'appdev', 'localhost', ...(process.env.PUBLIC_HOST ? [process.env.PUBLIC_HOST] : [])],
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
  },
});
