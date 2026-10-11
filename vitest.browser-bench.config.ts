import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// a full config rather than mergeConfig, which would concatenate the include lists
export default defineConfig({
  test: {
    include: ['benchmark/browser/**/*.test.ts'],
    // the results are printed with console.log, which Vitest hides when the tests pass
    silent: false,
    // Vitest ignores persistentContext when test files run in parallel
    fileParallelism: false,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [
        { browser: 'chromium' },
        { browser: 'firefox' },
        // WebKit rejects navigator.storage.getDirectory() (OPFS) in an ephemeral context
        { browser: 'webkit', provider: playwright({ persistentContext: true }) },
      ],
    },
  },
});
