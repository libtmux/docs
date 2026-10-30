import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Large generated models use JSON.parse instead of compiled object literals.
  json: { stringify: true, namedExports: false },
  // Astro supplies this virtual module inside a build; tests that read the project root use a stand-in.
  resolve: { alias: { 'astro:config/server': fileURLToPath(new URL('./test/astro-config-server.ts', import.meta.url)) } },
  test: {
    // Reuse transforms of the generated API and protocol catalogs across workers.
    fsModuleCache: true,
    // Report skipped assembly suites beside the summary, outside worker output.
    globalSetup: ['./test/global-setup.ts'],
  },
})
