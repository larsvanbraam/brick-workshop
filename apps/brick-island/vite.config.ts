import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite-plus';
import { ldrawLibraryPlugin } from '@brick-workshop/render/ldraw-library';
import { splashPlugin } from '@brick-workshop/render/splash-plugin';

export default defineConfig(({ mode }) => {
  const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));
  const env = loadEnv(mode, workspaceRoot, ['LDRAW_']);
  return {
    envDir: workspaceRoot,
    server: { host: '127.0.0.1' },
    preview: { host: '127.0.0.1' },
    // The island is built in a worker that imports the engine as a module.
    worker: { format: 'es' as const },
    plugins: [
      react(),
      splashPlugin({
        title: 'Brick Island',
        message: 'Loading…',
        colors: {
          background: '#1b1915',
          ink: '#f4f1ea',
          muted: '#c9c3b6',
          shadow: 'rgb(0 0 0 / 0.45)',
        },
      }),
      ldrawLibraryPlugin(resolve(workspaceRoot, env.LDRAW_LIBRARY_PATH || 'data/ldraw')),
    ],
  };
});
