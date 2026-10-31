import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite-plus';
import { ldrawLibraryPlugin } from './tooling/ldraw-library.ts';

export default defineConfig(({ mode }) => {
  const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));
  const env = loadEnv(mode, workspaceRoot, 'LDRAW_');
  return {
    plugins: [
      react(),
      ldrawLibraryPlugin(resolve(workspaceRoot, env.LDRAW_LIBRARY_PATH || 'data/ldraw')),
    ],
  };
});
