import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Large generated models use JSON.parse instead of compiled object literals.
  json: { stringify: true, namedExports: false },
  test: {
    // Report skipped assembly suites beside the summary, outside worker output.
    globalSetup: ['./test/global-setup.ts'],
  },
})
