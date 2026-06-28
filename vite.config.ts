import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    // Load .env files (including .env.local) for the current mode
    const env = loadEnv(mode, process.cwd(), '');

    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/api': {
            target: 'http://localhost:5000',
            changeOrigin: true,
          },
        },
      },
      plugins: [react()],
      define: {
        '__MAPBOX_TOKEN__': JSON.stringify(env.VITE_MAPBOX_TOKEN || env.MAPBOX_TOKEN || process.env.VITE_MAPBOX_TOKEN || process.env.MAPBOX_TOKEN || ''),
        '__GEMINI_API_KEY__': JSON.stringify(env.VITE_GEMINI_API_KEY || env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || ''),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
