import { defineConfig } from 'vitest/config'

/**
 * The theme package's own test config.
 *
 * It exists for one line — `setupFiles` — which registers the snapshot
 * serializer that keeps Tailwind's version banner out of recorded output.
 * Without it the package has no config at all, vitest runs with defaults, and
 * eight snapshots fail on a version string.
 */
export default defineConfig({
  test: {
    setupFiles: ['./src/test/setup.ts'],
  },
})
