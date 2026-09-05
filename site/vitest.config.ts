import { defineConfig } from 'vitest/config'

/**
 * Vitest ran with no config at all until this file.
 *
 * It exists for one reason — `globalSetup` runs in the main process, which is
 * where a message has to come from to land next to the summary rather than
 * inside one worker's captured output. Everything else is left at the
 * defaults deliberately: the suites were discovered and run correctly without
 * a config, and this should not become the place that quietly changes which
 * ones run.
 */
export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
  },
})
