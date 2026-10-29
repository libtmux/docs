import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Where a process writes the unresolved mentions it finds, or nowhere.
 *
 * The report is a file, shared by every process that opens it, and the build's ceiling (`integrations/dangling-report.ts`)
 * counts every line in it. A test run that renders the site's pages through the same plugin in the same checkout, beside
 * or just before a build, wrote hundreds of its own lines into the build's report and tripped the ceiling with names the
 * build never met. So a test writes nowhere unless it names a file of its own, and the build's file is only ever the
 * build's.
 */
export function danglingReportPath(env: Record<string, string | undefined> = process.env): string | undefined {
  if (env.LIBTMUX_DOCS_DANGLING_REPORT) return env.LIBTMUX_DOCS_DANGLING_REPORT
  return env.VITEST ? undefined : join(here, '../../.astro/dangling-refs.json')
}
