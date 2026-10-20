#!/usr/bin/env node
/**
 * What each port's owning manifests say it publishes, at the revision the API
 * model is pinned to.
 *
 * The header's package inventory (`site/src/lib/port-inventory.ts`) and the
 * destination verifier hold themselves to this file: an entry the manifests
 * do not declare, a declared package the inventory omits, and the version a
 * host must carry for a package all come from here rather than from a second
 * hand-written list. The file is generated from local checkouts, read with
 * `git show` at the pinned revision, so the checkout's current branch and
 * working tree do not matter.
 *
 * Usage:
 *   node scripts/gen-manifest-packages.mjs [--out <path>] [--check]
 *
 *   --out <path>  Write there (default: site/src/data/manifest-packages.json).
 *   --check       Write nothing; exit 1 if the file is out of date. A port whose
 *                 checkout or revision is absent is skipped and reported, as
 *                 other checks of source checkouts do.
 *
 * LIBTMUX_DOCS_CHECKOUT_<PORT> overrides a port's checkout, and
 * LIBTMUX_DOCS_WORKSPACE_PY and LIBTMUX_DOCS_MCP_PY the Python companions'.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORTS } from '../site/src/lib/ports.ts'
import { readPort, repositoryAt } from './lib/manifest-packages.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_OUT = join(root, 'site', 'src', 'data', 'manifest-packages.json')
const expand = (path) => (path.startsWith('~/') ? join(homedir(), path.slice(2)) : path)

const opts = { out: DEFAULT_OUT, check: false }
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--out') opts.out = argv[++i]
  else if (argv[i] === '--check') opts.check = true
  else if (argv[i] === '-h' || argv[i] === '--help') {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0])
    process.exit(0)
  } else throw new Error(`unrecognised argument: ${argv[i]}`)
}

/** The Python companions are pinned beside the library, in the API model's sources. */
const COMPANIONS = [
  { product: 'workspace', variable: 'LIBTMUX_DOCS_WORKSPACE_PY', fallback: '~/work/python/tmuxp' },
  { product: 'mcp', variable: 'LIBTMUX_DOCS_MCP_PY', fallback: '~/work/python/libtmux-mcp' },
]

const skipped = []
const ports = {}
for (const port of PORTS) {
  const model = JSON.parse(readFileSync(join(root, 'site', 'src', 'data', 'api', `${port.slug}.json`), 'utf8'))
  const checkout = expand(process.env[`LIBTMUX_DOCS_CHECKOUT_${port.slug.toUpperCase()}`] ?? port.checkout)
  const open = (path, revision) => {
    try {
      const repo = repositoryAt(path, revision)
      repo.has('.')
      return repo
    } catch { return undefined }
  }
  const core = open(checkout, model.revision)
  if (!core) { skipped.push(`${port.slug}: no ${model.revision} in ${checkout}`); continue }
  const read = readPort(port.slug, core, { identity: port.repo.split('/').pop() })
  const distributions = read.distributions.map((entry) => ({ ...entry, repo: port.repo, revision: model.revision }))
  if (port.slug === 'py') {
    for (const { product, variable, fallback } of COMPANIONS) {
      const source = model.sources.find((entry) => entry.product === product)
      const repo = open(expand(process.env[variable] ?? fallback), source.revision)
      if (!repo) { skipped.push(`py ${product}: no ${source.revision}`); continue }
      distributions.push(...readPort('py', repo, {}).distributions.map((entry) => ({ ...entry, repo: source.repo, revision: source.revision })))
    }
  }
  ports[port.slug] = {
    repo: port.repo, revision: model.revision,
    // A wrapper port builds on its parent's repository and lists only part of it.
    ...(port.parentLibrary ? { wrapper: port.parentLibrary.slug } : {}),
    distributions: distributions.sort((a, b) => a.name.localeCompare(b.name)),
    units: read.units.sort((a, b) => `${a.unit} ${a.name}`.localeCompare(`${b.unit} ${b.name}`)),
  }
}

const text = `${JSON.stringify({ schema: 1, ports }, null, 2)}\n`
for (const note of skipped) console.error(`skipped ${note}`)
if (opts.check) {
  if (skipped.length > 0) { console.log('manifest packages not checked: some checkouts or revisions are absent'); process.exit(0) }
  if (!existsSync(opts.out) || readFileSync(opts.out, 'utf8') !== text) {
    console.error(`${opts.out} is out of date. Run: node scripts/gen-manifest-packages.mjs`)
    process.exit(1)
  }
  console.log(`${opts.out} is current`)
} else {
  if (skipped.length > 0) throw new Error('refusing to write a partial file; provide the missing checkouts')
  writeFileSync(opts.out, text)
  console.log(`wrote ${opts.out}`)
}
