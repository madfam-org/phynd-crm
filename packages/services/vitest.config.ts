import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@phynd/db/schema',
        replacement: fileURLToPath(new URL('../db/src/schema/index.ts', import.meta.url)),
      },
      {
        find: '@phynd/db/client',
        replacement: fileURLToPath(new URL('../db/src/client.ts', import.meta.url)),
      },
      {
        find: '@phynd/db',
        replacement: fileURLToPath(new URL('../db/src/index.ts', import.meta.url)),
      },
      {
        find: '@phynd/logging',
        replacement: fileURLToPath(new URL('../logging/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      thresholds: {
        statements: 70,
        branches: 60,
        functions: 70,
        lines: 70,
      },
    },
  },
})
