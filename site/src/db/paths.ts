import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** Repository `site/` directory. */
export const SITE_ROOT = join(here, '../..')

/** Extracted models, written by `scripts/gen-api-model.mjs`. */
export const MODEL_DIR = join(SITE_ROOT, 'src/data/api')

/**
 * The generated database.
 *
 * Under `node_modules/.cache` rather than `src/`: it is derived, it is
 * rebuilt on every build, and it must never be committed or picked up by the
 * content loader's glob.
 *
 * One file per vitest worker. Several suites reseed the store — the pruning
 * one drives a deliberately shrunken manifest — and vitest runs files in
 * parallel, so a shared path lets one suite's synthetic two-version manifest
 * become another's idea of reality. That produced a failure roughly one run
 * in five, in a different suite each time, which reads as flakiness rather
 * than as the collision it is. A build sets nothing and keeps the plain name.
 */
const worker = process.env.VITEST_WORKER_ID
export const DB_PATH = join(
  SITE_ROOT,
  `node_modules/.cache/libtmux-api${worker ? `-w${worker}` : ''}.sqlite`,
)

export const SCHEMA_PATH = join(here, 'schema.sql')
