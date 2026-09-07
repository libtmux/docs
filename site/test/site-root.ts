import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE_ONLY = process.env.LIBTMUX_DOCS_TEST_SOURCE_ONLY === '1'

export const BUCKET_ROOT: string = process.env.LIBTMUX_DOCS_TEST_SITE
  ? resolve(process.env.LIBTMUX_DOCS_TEST_SITE)
  : join(HERE, '../../_site')

/** The default-locale content tree, or a bare shell build used by a test. */
export const SITE_ROOT = existsSync(join(BUCKET_ROOT, 'en', 'index.html'))
  ? join(BUCKET_ROOT, 'en')
  : BUCKET_ROOT
export const SITE_PREFIX = relative(BUCKET_ROOT, SITE_ROOT).replaceAll('\\', '/')
  .replace(/(.+)/, '$1/')

/** Resolve a published URL path from the bucket root. */
export const publishedPath = (...parts: string[]): string => join(BUCKET_ROOT, ...parts)
export const publishedHas = (path: string): boolean => existsSync(publishedPath(path))

/** Output suites must not read an assembly while its lock is held. */
function assemblyRunning(): boolean {
  const lock = join(HERE, '../../.build.lock')
  if (!existsSync(lock)) return false
  try {
    // Shared probes coexist; the assembly holds an exclusive lock.
    execFileSync('flock', ['-n', '-s', lock, 'true'], { stdio: 'ignore' })
    return false
  } catch {
    return true
  }
}

export const ASSEMBLY_RUNNING: boolean = !SOURCE_ONLY && assemblyRunning()

/** Whether a complete tree is present for these suites to read. */
export const SITE_BUILT: boolean = !SOURCE_ONLY && !ASSEMBLY_RUNNING && existsSync(join(SITE_ROOT, 'index.html'))

/** Report why output suites could not run. */
export const SKIP_REASON: string | undefined = SOURCE_ONLY
  ? 'source-only mode excludes assembled-output checks'
  : ASSEMBLY_RUNNING
  ? `an assembly holds .build.lock — suites reading ${SITE_ROOT} were skipped rather than ` +
    'measuring a tree mid-rebuild'
  : !existsSync(join(SITE_ROOT, 'index.html'))
    ? `nothing assembled at ${SITE_ROOT} — run scripts/build-site.sh`
    : undefined

/** Path inside the assembled tree. */
export const sitePath = (...parts: string[]): string => join(SITE_ROOT, ...parts)

/** Whether a path exists in the assembled tree. */
export const siteHas = (rel: string): boolean => existsSync(join(SITE_ROOT, rel))
