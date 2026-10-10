import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Les specs de persistance écrivent des fichiers dans le cwd :
    // chaque worker est un process isolé qui bascule dans un dossier temporaire.
    pool: 'forks',
    setupFiles: ['tests/helpers/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text', 'html'],
    },
  },
});
