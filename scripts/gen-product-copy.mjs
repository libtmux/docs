#!/usr/bin/env node
/**
 * Cache what the Workspace and MCP product pages may claim about each port.
 *
 * The page copy names the verbs a port's workspace tool has, the formats it
 * reads and the SDK its MCP server is built on. Every claim is listed in
 * `lib/product-copy-sources.mjs` with the strings that show it, and this
 * script reads those strings from committed bytes at the revision the port's
 * API model records for the product. A `find` string that is missing, or an
 * `absent` one that is present, fails the run, so a verb a port does not have
 * cannot be written down. It stores the claims and the line of each string in
 * `site/src/data/product-copy.json`.
 *
 *   node scripts/gen-product-copy.mjs           write the data file
 *   node scripts/gen-product-copy.mjs --check   compare it with the sources
 *   ... --data <file>                           use another data file, such as a copy to check
 *
 * Without a port's checkout, `--check` verifies that the committed entry still
 * describes the sources, and that it was read at the revision the API model
 * records now. The lines come from the port's files, so only a run with the
 * checkout compares them.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORT_BY_SLUG } from '../site/src/lib/ports.ts'
import { hasRevision, readAt } from './gen-workspace-showcase.mjs'
import { MCP, VERBS, WORKSPACE } from './lib/product-copy-sources.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(root, 'site/src/data/product-copy.json')
const { checkoutFor, expand } = await import(`file://${join(root, 'site/src/plugins/remark-port-code.mjs')}`)

const listed = (value) => (value === undefined ? [] : [value].flat())
const lineOf = (text, index) => text.slice(0, index).split('\n').length

/** The repository and revision the port's API model records for a product. */
export function pinned(port, product) {
  const model = JSON.parse(readFileSync(join(root, `site/src/data/api/${port}.json`), 'utf8'))
  const source = model.sources?.find((entry) => entry.product === product)
  if (!source) throw new Error(`${port}: the API model records no ${product} package`)
  return { repo: source.repo, revision: source.revision }
}

/** A checkout that has the revision's objects. */
function findCheckout(port, spec, revision) {
  const candidates = [process.env[`LIBTMUX_DOCS_CHECKOUT_${port.toUpperCase()}`], spec.checkout, checkoutFor(port), PORT_BY_SLUG[port]?.worktree, PORT_BY_SLUG[port]?.checkout]
    .filter(Boolean).map(expand)
  return candidates.find((candidate) => hasRevision({ checkout: candidate, revision }))
}

/** What a check names, apart from the lines it was found on. */
const checkShape = (check) => ({ path: check.path, find: listed(check.find).map((text) => (typeof text === 'string' ? text : text.text)), absent: listed(check.absent) })

/**
 * Read one check from the file's bytes: each `find` string with its line, and
 * each `absent` string confirmed to be missing.
 */
export function locateCheck(body, check, label) {
  const finds = listed(check.find).map((text) => {
    const index = body.indexOf(text)
    if (index < 0) throw new Error(`${label}: ${JSON.stringify(text)} is not in ${check.path}`)
    return { text, line: lineOf(body, index) }
  })
  for (const text of listed(check.absent)) {
    const index = body.indexOf(text)
    if (index >= 0) throw new Error(`${label}: ${JSON.stringify(text)} is in ${check.path}, line ${lineOf(body, index)}`)
  }
  return { path: check.path, find: finds, absent: listed(check.absent) }
}

/** The claims of one source entry, as the data file stores them. */
function claims(product, spec) {
  if (product === 'workspace') {
    const unknown = spec.verbs.filter((verb) => !VERBS.includes(verb))
    if (unknown.length) throw new Error(`unknown verbs ${unknown.join(', ')}; the page knows ${VERBS.join(', ')}`)
    return { verbs: spec.verbs, formats: spec.formats, ...(spec.formatNote ? { formatNote: spec.formatNote } : {}) }
  }
  return { ...(spec.sdk ? { sdk: spec.sdk } : {}), ...(spec.protocol ? { protocol: spec.protocol } : {}) }
}

/** What an entry must say, without lines: the claims, the revision and the strings. */
export function shapeOf(entry) {
  return JSON.stringify({ ...entry, checks: entry.checks.map(checkShape) })
}

/** The entry the sources and the API model describe, without lines. */
function expected(product, port, spec) {
  const { repo, revision } = pinned(port, product)
  return { repo, revision, ...claims(product, spec), checks: spec.checks.map((check) => ({ path: check.path, find: listed(check.find), absent: listed(check.absent) })) }
}

/** Build one entry from a checkout, or confirm the committed one when none is present. */
export function buildEntry(product, port, spec, previous) {
  const want = expected(product, port, spec)
  const checkout = findCheckout(port, spec, want.revision)
  if (!checkout) {
    if (previous && shapeOf(previous) === JSON.stringify({ ...want, checks: want.checks.map(checkShape) })) return { entry: previous, offline: true }
    throw new Error(`${port} ${product}: no verified cache for ${want.repo}@${want.revision}; provide its checkout and regenerate the product copy`)
  }
  const checks = spec.checks.map((check) => locateCheck(readAt({ checkout, revision: want.revision, path: check.path }), check, `${port} ${product}`))
  return { entry: { ...want, checks }, offline: false }
}

function dataFile(argv) {
  const at = argv.indexOf('--data')
  return at < 0 ? OUT : resolve(argv[at + 1] ?? '')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check')
  const file = dataFile(process.argv)
  let committed = {}
  try { committed = JSON.parse(readFileSync(file, 'utf8')) } catch { /* A first run has nothing to compare. */ }
  const out = { schema: 1, workspace: {}, mcp: {} }
  let offline = 0
  for (const [product, sources] of [['workspace', WORKSPACE], ['mcp', MCP]]) {
    for (const [port, spec] of Object.entries(sources)) {
      const built = buildEntry(product, port, spec, committed[product]?.[port])
      out[product][port] = built.entry
      if (built.offline) offline += 1
    }
  }
  const text = `${JSON.stringify(out, null, 2)}\n`
  if (check) {
    if (JSON.stringify(committed) !== JSON.stringify(out)) {
      console.error('gen-product-copy: the committed product copy differs from its sources; run scripts/gen-product-copy.mjs')
      process.exit(1)
    }
    console.log(`gen-product-copy: cache matches${offline ? ` (${offline} entries verified from the cache; checkouts unavailable)` : ''}`)
  } else {
    writeFileSync(file, text)
    console.log(`gen-product-copy: wrote ${Object.keys(out.workspace).length + Object.keys(out.mcp).length} entries`)
  }
}
