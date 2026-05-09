import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  // Bundle workspace packages into the output (they only have .ts source)
  noExternal: [
    '@phynd/logging',
    '@phynd/config',
    '@phynd/db',
    '@phynd/services',
    '@phynd/federation',
    '@phynd/types',
  ],
})
