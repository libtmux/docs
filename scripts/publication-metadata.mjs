#!/usr/bin/env node
/**
 * Declare what the shell owns in the publication artifact.
 *
 * Writes `shell-paths.json`, `reserved-products.txt` and
 * `reserved-prefixes.txt` beside the assembly. `publish-root.sh` refuses to
 * sync anything a
 * reserved prefix holds that these files do not declare, so a port whose tree
 * this build did not produce is never bulk-touched.
 *
 * A file rather than a `run:` block, for the reason `publish-root.sh` is one:
 * `site/test/publish-prefixes.test.ts` drives the same text the deploy runs.
 *
 * Inputs resolve against the working directory — the assembly in `_site/`, and
 * the port and locale modules — so a test can run it against a fixture.
 */
import { readdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const load = (path) => import(pathToFileURL(resolve(path)).href)
const { PORTS, DOC_PRODUCTS } = await load('site/src/lib/ports.ts')
const { DEFAULT_LOCALE } = await load('site/src/i18n/locales.ts')

const paths = { schema: 1, locale: DEFAULT_LOCALE, directories: [], files: [] }
for (const port of PORTS) {
  const prefix = `${port.slug}/latest`
  for (const entry of readdirSync(`_site/${DEFAULT_LOCALE}/${prefix}`, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in shell assembly: ${prefix}/${entry.name}`)
    // The assembly checks native targets; this artifact never publishes them.
    if (entry.name === 'api') {
      rmSync(`_site/${DEFAULT_LOCALE}/${prefix}/api`, { recursive: true })
      continue
    }
    paths[entry.isDirectory() ? 'directories' : 'files'].push(`${prefix}/${entry.name}`)
  }
}
writeFileSync('shell-paths.json', `${JSON.stringify(paths)}\n`)
writeFileSync('reserved-products.txt', `${Object.keys(DOC_PRODUCTS).join('\n')}\n`)
writeFileSync('reserved-prefixes.txt', `${PORTS.map((p) => p.slug).join('\n')}\n`)
