import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

function privacyCleanUrlPlugin(): Plugin {
  const rewriteCleanUrl = (
    middlewares: { use: (fn: (req: { url?: string }, res: unknown, next: () => void) => void) => void },
  ) => {
    middlewares.use((req, _res, next) => {
      if (req.url === '/privacy-policy' || req.url === '/privacy-policy/') {
        req.url = '/privacy-policy.html';
      }
      next();
    });
  };

  return {
    name: 'privacy-clean-url',
    configureServer(server) {
      rewriteCleanUrl(server.middlewares);
    },
    configurePreviewServer(server) {
      rewriteCleanUrl(server.middlewares);
    },
  };
}

export default defineConfig({
  plugins: [react(), privacyCleanUrlPlugin()],
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: path.resolve(rootDir, 'index.html'),
        privacyPolicy: path.resolve(rootDir, 'privacy-policy.html'),
      },
    },
  },
});

