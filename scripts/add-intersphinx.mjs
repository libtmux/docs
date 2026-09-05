#!/usr/bin/env node
/**
 * Teach a port's own Sphinx build about the other seven.
 *
 * The Python and C++ references are built by upstream's `conf.py`, in a
 * disposable worktree this script owns. Appending to that copy is how
 * `:class:`libtmux-rs:Pane`` resolves from a Python docstring without asking
 * eight upstream projects to agree on anything — which is what intersphinx is
 * for, and the reason it federates by configuration rather than by protocol.
 *
 * Inventories are read from the local build, not fetched. The site they
 * describe may not be deployed yet, and a docs build should not need the
 * network in any case; intersphinx takes the target URI and the inventory
 * location as separate arguments precisely so this works.
 *
 * Usage: add-intersphinx.mjs <conf-dir> <site-dir> <base-url> [skip-port]
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const [confDir, siteDir, baseUrl, skipPort] = process.argv.slice(2)
if (!confDir || !siteDir || !baseUrl) {
  console.error('usage: add-intersphinx.mjs <conf-dir> <site-dir> <base-url> [skip-port]')
  process.exit(2)
}

const conf = join(confDir, 'conf.py')
if (!existsSync(conf)) {
  console.error(`no conf.py in ${confDir}`)
  process.exit(1)
}

const MARKER = '# libtmux.org intersphinx (generated)'
if (readFileSync(conf, 'utf8').includes(MARKER)) {
  console.log('conf.py already augmented')
  process.exit(0)
}

const PORTS = ['py', 'ts', 'rs', 'go', 'java', 'dotnet', 'cxx', 'swift']
const entries = []
for (const port of PORTS) {
  if (port === skipPort) continue
  const inv = join(siteDir, 'reference', port, 'objects.inv')
  if (!existsSync(inv)) continue
  entries.push([`libtmux-${port}`, `${baseUrl.replace(/\/*$/, '')}/reference/${port}/`, inv])
}

if (!entries.length) {
  console.log('no inventories found; conf.py left alone')
  process.exit(0)
}

// Merged rather than assigned: upstream's own mapping — CPython, pytest — has
// to survive, and a `conf.py` that silently dropped it would break far more
// links than this adds.
const block = `

${MARKER}
#
# Written by scripts/add-intersphinx.mjs into a disposable worktree. The
# inventories are read from the local build so this resolves with no network
# and before the site is deployed; the URIs are where the pages will live.
intersphinx_mapping = {
    **globals().get("intersphinx_mapping", {}),
${entries.map(([name, uri, inv]) => `    ${JSON.stringify(name)}: (${JSON.stringify(uri)}, ${JSON.stringify(inv)}),`).join('\n')}
}
`

appendFileSync(conf, block)
console.log(`conf.py: added ${entries.length} inventories (${entries.map((e) => e[0]).join(', ')})`)
