import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'c8',
      reportsDirectory: 'out/coverage',
    },
    globals: true,
  },
});
