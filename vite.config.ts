import { defineConfig } from 'vite-plus';

export default defineConfig({
  defaultPackage: './apps/web',
  test: { include: ['packages/**/*.test.ts', 'apps/web/tooling/**/*.test.ts'] },
  lint: { plugins: ['typescript', 'react'] },
  fmt: { singleQuote: true, semi: true },
});
