import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    // Determinism is a project invariant: no test may rely on wall-clock time.
    clearMocks: true,
    restoreMocks: true,
  },
});
