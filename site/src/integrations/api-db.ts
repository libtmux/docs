import type { AstroIntegration } from 'astro'
import { seed } from '../db'

/**
 * Build the API projection before anything renders.
 *
 * `astro:config:setup` rather than a later hook: page modules query the
 * database from `getStaticPaths`, which runs before `astro:build:start`, so
 * seeding any later would be seeding after the first read.
 *
 * Seeding is a second or so over 13,753 symbols and is pure derived work, so
 * it runs unconditionally rather than trying to decide whether it is stale.
 * Guessing wrong in the cheap direction costs a second; guessing wrong in the
 * other renders a reference from a model that no longer exists.
 */
export function apiDb(): AstroIntegration {
  return {
    name: 'libtmux:api-db',
    hooks: {
      'astro:config:setup': ({ logger }) => {
        const started = performance.now()
        const result = seed()
        const elapsed = Math.round(performance.now() - started)
        logger.info(`seeded ${result.rows} symbols from ${result.ports} ports in ${elapsed}ms`)

        // An id collision means one port's extractor produced two symbols the
        // store cannot tell apart, and the second was dropped. It is upstream
        // and it is not fatal, but it is silent data loss unless someone says
        // so on every build.
        for (const [port, n] of Object.entries(result.collisions)) {
          logger.warn(`${port}: ${n} symbols dropped, duplicate ids from the extractor`)
        }
      },
    },
  }
}
