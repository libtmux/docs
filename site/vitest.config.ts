import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Reuse transforms of the generated API and protocol catalogs across workers.
    fsModuleCache: true,
    globalSetup: ['./test/global-setup.ts'],
  },
})
