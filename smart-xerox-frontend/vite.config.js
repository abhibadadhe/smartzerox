import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Fail production builds when required env vars are missing */
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
      // Warn if using test key in production
      if (env.VITE_RAZORPAY_KEY && env.VITE_RAZORPAY_KEY.startsWith('rzp_test_')) {
        console.warn('⚠️  WARNING: Using Razorpay TEST key in production build!');
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
  esbuild: {
    drop: mode === 'production' ? ['console', 'debugger'] : [],
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: ['log', 'debug'], // Keep console.error and console.warn
        drop_debugger: true,
      },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          ui: ['@radix-ui/react-label', '@radix-ui/react-slot', '@radix-ui/react-toast', '@radix-ui/react-tooltip'],
          query: ['@tanstack/react-query'],
          socket: ['socket.io-client'],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
}));
