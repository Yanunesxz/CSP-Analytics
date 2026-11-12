import { defineConfig } from 'vitest/config';

// Cada arquivo de teste sobe o próprio PGlite e aplica as migrações uma vez (tests/apoio/banco.ts).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
