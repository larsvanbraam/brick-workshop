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
    // The world is generated in a worker that imports the engine as a module.
    worker: { format: 'es' as const },
    build: {
      // three.js and React rarely change, so they get their own chunk: a deploy then only
      // invalidates the small app chunk in returning visitors' caches. The chunks are still
      // all needed at startup, so the limit only quiets the size warning.
      chunkSizeWarningLimit: 1500,
      rolldownOptions: {
        output: {
          codeSplitting: { groups: [{ name: 'vendor', test: /node_modules/ }] },
        },
      },
    },
    plugins: [
      react(),
      splashPlugin({
        title: 'Brick World',
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
