import { fileURLToPath } from 'node:url';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export const WEBKIT_PROFILE = fileURLToPath(
  new URL('../node_modules/.cache/lokits-bench-webkit', import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: {
      '@mitata/counters': fileURLToPath(
        new URL('./browser/mitata-counters-stub.ts', import.meta.url),
      ),
    },
  },
  optimizeDeps: {
    // the package loads its .wasm next to its own files
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  test: {
    include: ['bench/browser/**/*.bench.ts'],
    silent: false,
    // one engine per page, never two at once
    fileParallelism: false,
    testTimeout: 60 * 60_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [
        { browser: 'chromium' },
        { browser: 'firefox' },
        // WebKit rejects navigator.storage.getDirectory() (OPFS) in an ephemeral context; the bench
        // keeps its own profile, recreated by browser-run.ts, apart from the test suite's
        { browser: 'webkit', provider: playwright({ persistentContext: WEBKIT_PROFILE }) },
      ],
    },
  },
});
