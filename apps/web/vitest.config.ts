import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: ['node_modules', 'e2e', '.next'],
    passWithNoTests: true,
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
  resolve: {
    alias: [
      {
        find: '@phynd/services/payments/payment-reconciliation',
        replacement: path.resolve(__dirname, '../../packages/services/src/payments/payment-reconciliation.service.ts'),
      },
      {
        find: '@phynd/services/payments/dhanam-checkout',
        replacement: path.resolve(__dirname, '../../packages/services/src/payments/dhanam-checkout.service.ts'),
      },
      {
        find: /^@phynd\/([^/]+)(\/.*)?$/,
        replacement: `${path.resolve(__dirname, '../../packages')}/$1/src$2`,
      },
      {
        find: '@',
        replacement: path.resolve(__dirname, './src'),
      },
    ],
  },
})
