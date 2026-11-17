import { defineConfig } from 'vite-plus';

export default defineConfig({
  defaultPackage: './apps/brick-studio',
  test: {
    include: [
      'packages/**/*.test.ts',
      'apps/brick-studio/tooling/**/*.test.ts',
      'apps/brick-world/src/**/*.test.ts',
    ],
  },
  lint: {
    plugins: ['typescript', 'react'],
    // react-three-fiber code mutates three.js objects and refs inside useFrame by design.
    rules: { 'react/immutability': 'off' },
  },
  fmt: { singleQuote: true, semi: true },
});
