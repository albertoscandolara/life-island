import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/svc-ingestion',
  test: {
    name: 'svc-ingestion',
    watch: false,
    globals: true,
    environment: 'node',
    // The integration tests share one database, and some hold the global
    // reclassification lock for a moment: run the files one after another.
    fileParallelism: false,
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
