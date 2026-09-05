import { SKIP_REASON } from './site-root.ts'

/**
 * Say why suites were skipped, where the reader is already looking.
 *
 * vitest reports a skip as a count. The reason used to be a `console.warn`
 * fired when the first worker imported `site-root.ts`, which by the end of a
 * run sits hundreds of lines above the summary — so "37 skipped" arrived with
 * no explanation attached and read like coverage that had quietly
 * disappeared. That warning is gone; this replaces it rather than joining it,
 * so there is one message and it is in the right place.
 *
 * This runs in the main process, not a worker, so it prints once rather than
 * once per test file, and it prints at teardown, immediately before the
 * counts.
 */
export default function setup(): () => void {
  return () => {
    if (SKIP_REASON) console.warn(`\nassembled-tree suites skipped: ${SKIP_REASON}`)
  }
}
