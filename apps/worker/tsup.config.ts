import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  // Bundle workspace packages into the output (they only have .ts source)
  noExternal: [
    '@phyne/logging',
    '@phyne/config',
    '@phyne/db',
    '@phyne/services',
    '@phyne/federation',
    '@phyne/types',
  ],
})
