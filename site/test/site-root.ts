import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The assembled tree the output suites read.
 *
 * Several suites assert against built HTML rather than source, and they skip
 * when there is nothing built. That is right for a fresh checkout and wrong
 * everywhere else: `scripts/test-all.sh` builds the shell into a scratch
 * directory, so pointed at `_site` those suites would find nothing, skip, and
 * report green having checked no pages at all. CI would have been the first
 * place that happened and the last place anyone noticed.
 *
 * So the root is injectable. `test-all.sh` sets `LIBTMUX_DOCS_TEST_SITE` to
 * whatever it just built; a bare `vitest` falls back to `_site` from the last
 * assembly.
 */
const HERE = dirname(fileURLToPath(import.meta.url))

export const SITE_ROOT: string = process.env.LIBTMUX_DOCS_TEST_SITE
  ? resolve(process.env.LIBTMUX_DOCS_TEST_SITE)
  : join(HERE, '../../_site')

/**
 * Whether an assembly is writing the tree right now.
 *
 * `build-site.sh` opens with `rm -rf "$out_dir"`, so a suite that reads
 * `_site` while one runs sees a directory that is empty, half-populated, or
 * gone between two calls. That produced two failures which looked like real
 * defects — a missing `_site/topics`, and 161 versions "advertised but not
 * built" — and were neither.
 *
 * The assembly holds `.build.lock`, so asking the kernel is exact. Reported
 * rather than worked around: a suite that cannot measure should say so, not
 * quietly pass.
 */
function assemblyRunning(): boolean {
  // Resolved from this file, not from SITE_ROOT. The lock belongs to the
  // repository, and SITE_ROOT is injectable — when it pointed at a scratch
  // directory under /tmp, this looked for `/tmp/.build.lock`, found nothing,
  // and reported that no assembly was running. The guard switched itself off
  // in precisely the case it was written for.
  const lock = join(HERE, '../../.build.lock')
  if (!existsSync(lock)) return false
  try {
    // `flock -n` exits 1 when the lock is held. Run it against the file
    // rather than opening a descriptor here, so this never becomes the holder.
    execFileSync('flock', ['-n', lock, 'true'], { stdio: 'ignore' })
    return false
  } catch {
    return true
  }
}

export const ASSEMBLY_RUNNING: boolean = assemblyRunning()

/** Whether a complete tree is present for these suites to read. */
export const SITE_BUILT: boolean = !ASSEMBLY_RUNNING && existsSync(join(SITE_ROOT, 'index.html'))

/**
 * Why the assembled-tree suites have no opinion, when they have none.
 *
 * A skip is a check that did not run, and vitest reports one as a number: "37
 * skipped", with the reason in a warning printed hundreds of lines earlier.
 * That is enough to be misread as a coverage regression — it was, by someone
 * reading this output an hour before this line was written.
 *
 * `test/global-setup.ts` prints it next to the counts, which is the only
 * place a reader is looking when the run ends.
 */
export const SKIP_REASON: string | undefined = ASSEMBLY_RUNNING
  ? `an assembly holds .build.lock — suites reading ${SITE_ROOT} were skipped rather than ` +
    'measuring a tree mid-rebuild'
  : !existsSync(join(SITE_ROOT, 'index.html'))
    ? `nothing assembled at ${SITE_ROOT} — run scripts/build-site.sh`
    : undefined

/** Path inside the assembled tree. */
export const sitePath = (...parts: string[]): string => join(SITE_ROOT, ...parts)

/** Whether a path exists in the assembled tree. */
export const siteHas = (rel: string): boolean => existsSync(join(SITE_ROOT, rel))
