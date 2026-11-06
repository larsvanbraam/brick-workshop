import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite-plus';
import { ldrawLibraryPlugin } from './tooling/ldraw-library.ts';
import { savedBuildsPlugin } from './tooling/saved-builds.ts';

export default defineConfig(({ mode }) => {
  const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));
  const env = loadEnv(mode, workspaceRoot, ['LDRAW_', 'WORKSHOP_']);
  const proxy = {
    '/api/workshop': {
      target: `http://127.0.0.1:${env.WORKSHOP_API_PORT || '8787'}`,
      changeOrigin: false,
    },
  };
  return {
    server: { host: '127.0.0.1', proxy },
    preview: { host: '127.0.0.1', proxy },
    build: {
      rollupOptions: {
        input: {
          main: fileURLToPath(new URL('index.html', import.meta.url)),
          instructions: fileURLToPath(new URL('instructions.html', import.meta.url)),
        },
      },
    },
    plugins: [
      react(),
      ldrawLibraryPlugin(resolve(workspaceRoot, env.LDRAW_LIBRARY_PATH || 'data/ldraw')),
      savedBuildsPlugin(
        resolve(workspaceRoot, env.WORKSHOP_BUILDS_PATH || 'builds'),
        workspaceRoot,
      ),
    ],
  };
});
