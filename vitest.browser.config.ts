import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/real-browser/**/*.test.ts'],
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
