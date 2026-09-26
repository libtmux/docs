import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Large generated models use JSON.parse instead of compiled object literals.
  json: { stringify: true, namedExports: false },
  test: {
    // Reuse transforms of the generated API and protocol catalogs across workers.
    fsModuleCache: true,
    // Report skipped assembly suites beside the summary, outside worker output.
    globalSetup: ['./test/global-setup.ts'],
  },
})
