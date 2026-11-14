import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite-plus';
import { ldrawLibraryPlugin } from '@brick-workshop/render/ldraw-library';

export default defineConfig(({ mode }) => {
  const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));
  const env = loadEnv(mode, workspaceRoot, ['LDRAW_']);
  return {
    envDir: workspaceRoot,
    server: { host: '127.0.0.1' },
    preview: { host: '127.0.0.1' },
    // The world is generated in a worker that imports the engine as a module.
    worker: { format: 'es' as const },
    plugins: [
      react(),
      ldrawLibraryPlugin(resolve(workspaceRoot, env.LDRAW_LIBRARY_PATH || 'data/ldraw')),
    ],
  };
});
