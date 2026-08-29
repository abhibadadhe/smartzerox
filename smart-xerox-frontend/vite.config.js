import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function envValidationPlugin(mode) {
  return {
    name: 'env-validation',
    buildStart() {
      if (mode !== 'production') return;
      const env = loadEnv(mode, process.cwd(), '');
      const missing = [];
      if (!env.VITE_API_URL) missing.push('VITE_API_URL');
      if (!env.VITE_SOCKET_URL) missing.push('VITE_SOCKET_URL');
      if (!env.VITE_RAZORPAY_KEY) missing.push('VITE_RAZORPAY_KEY');
      if (missing.length) {
        throw new Error(
          `Production build blocked — set in .env or CI: ${missing.join(', ')}`
        );
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), envValidationPlugin(mode)],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild',
    target: 'es2020',
    chunkSizeWarningLimit: 2500,
  },
}));
