import { defineConfig } from 'vite-plus';

export default defineConfig({
  defaultPackage: './apps/web',
  test: {
    include: [
      'packages/**/*.test.ts',
      'apps/web/tooling/**/*.test.ts',
      'apps/studlands/src/**/*.test.ts',
    ],
  },
  lint: {
    plugins: ['typescript', 'react'],
    // react-three-fiber code mutates three.js objects and refs inside useFrame by design.
    rules: { 'react/immutability': 'off' },
  },
  fmt: { singleQuote: true, semi: true },
});
