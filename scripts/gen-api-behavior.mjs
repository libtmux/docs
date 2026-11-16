#!/usr/bin/env node
/**
 * Read behaviour facts from each port's doc comments at the revision its model documents.
 *
 * For every callable with a source line, `extractBehavior` reads the doc comment above the declaration in the file at
 * the pinned revision (`git show <revision>:<file>`, never a working tree) and keeps the sentences that state ownership,
 * a bound, completion, errors, transport, cleanup or mutation, each with its line. Curated entries add a fact a doc
 * comment does not state in a form the cues catch; each cites a line and quotes the words it relies on, and the
 * generator refuses one whose line no longer says them. The result is a sidecar the site merges into the model:
 *
 *   site/src/data/api/<port>.behavior.json
 *
 * `--check` regenerates in memory and fails when the committed sidecar differs; without the port's checkout it
 * re-verifies the committed facts against their recorded evidence lines instead.
 *
 * `--source-bound <port>` is for a build that has just regenerated the port's model from a verified checkout
 * (`scripts/build-site.sh`): the sidecar is rewritten for that model's revision, so the two always agree, and a
 * missing checkout is an error. A curated fact whose quoted words moved to another line is re-pinned to where they
 * now stand; one whose words are gone, and any fact that does not verify, is left out with a warning instead of
 * failing a port's build over an enrichment, so the page never cites a line that does not say what the row says.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { BEHAVIOR_ROWS, extractBehavior, orderBehavior, verifyBehavior } from '../packages/api-model/src/behavior.ts'
import { checkoutOverride } from './lib/port-checkout.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** Ports whose doc comments state completion, ownership and errors, and the comment grammar each uses. */
export const PORTS = { go: { style: 'go', checkout: '~/work/libtmux/libtmux-go-docs' }, rs: { style: 'rust', checkout: '~/work/libtmux/libtmux-rs' } }
const home = (path) => (path.startsWith('~/') ? join(process.env.HOME ?? '', path.slice(2)) : path)
const squash = (text) => text.replace(/\s+/g, ' ').trim()

/** The file at the pinned revision, as lines; a missing checkout or revision is `undefined`, not an error. */
export function pinnedLines(checkout, revision, file) {
  if (!checkout || !existsSync(checkout)) return undefined
  try {
    return execFileSync('git', ['-C', checkout, 'show', `${revision}:${file}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).split('\n')
  } catch { return undefined }
}

export function curatedPath() { return join(root, 'site/src/data/api-behavior-curated.json') }

/** Where a curated fact's quoted words stand now: its recorded line, else the one line of the file that holds them. */
export function locateQuote(lines, entry, style) {
  const marker = style === 'go' ? /^\s*\/\/ ?/ : /^\s*\/\/\/ ?/
  const holds = (number) => squash((lines[number - 1] ?? '').replace(marker, '')).includes(squash(entry.quote))
  if (holds(entry.line)) return entry.line
  const found = lines.flatMap((_, index) => (holds(index + 1) ? [index + 1] : []))
  return found.length === 1 ? found[0] : undefined
}

/**
 * Build the sidecar of one port from its model, its pinned source and the curated entries.
 * `tolerant` is for a model regenerated at a new revision, whose lines may have moved: it re-pins a curated fact
 * to its quote and reports what it leaves out in `dropped` instead of `problems`.
 */
export function buildSidecar(port, { model, curated = {}, linesOf, tolerant = false }) {
  const { style } = PORTS[port]
  const symbols = {}
  const problems = []
  const dropped = []
  for (const symbol of model.symbols) {
    const lines = symbol.source?.file ? linesOf(symbol.source.file) : undefined
    if (!lines) continue
    const behavior = extractBehavior(symbol, lines, style) ?? {}
    const quotes = {}
    for (const entry of curated[symbol.publicId ?? symbol.id] ?? []) {
      if (!BEHAVIOR_ROWS.includes(entry.row)) { problems.push(`${symbol.id}: unknown row ${entry.row}`); continue }
      const line = tolerant ? locateQuote(lines, entry, style) : entry.line
      if (line === undefined) { dropped.push(`${symbol.id} ${entry.row}: no single line holds the quoted words`); continue }
      behavior[entry.row] = { text: entry.text, source: { file: symbol.source.file, line }, origin: 'curated', ...(entry.via ? { via: entry.via } : {}) }
      quotes[entry.row] = entry.quote
    }
    if (!Object.keys(behavior).length) continue
    const ordered = orderBehavior(behavior)
    const unsound = verifyBehavior(symbol, ordered, lines, style, quotes)
    if (tolerant && unsound.length) { dropped.push(...unsound); continue }
    for (const problem of unsound) problems.push(problem)
    const evidence = {}
    for (const row of [...BEHAVIOR_ROWS, 'requires']) {
      const fact = ordered[row]
      if (!fact) continue
      const source = row === 'requires' ? fact.source : fact.source
      evidence[row] = { line: source.line, text: squash((lines[source.line - 1] ?? '').replace(style === 'go' ? /^\s*\/\/ ?/ : /^\s*\/\/\/ ?/, '')) }
    }
    symbols[symbol.publicId ?? symbol.id] = { behavior: ordered, evidence }
  }
  return { sidecar: { port, repo: model.repo, revision: model.revision, symbols }, problems, dropped }
}

/**
 * Re-verify a committed sidecar without the checkout: it is for this model's revision, and every fact is what the
 * evidence line it recorded says. A hand edit to a fact's text or line fails here.
 */
export function verifySidecar(port, sidecar, model) {
  const { style } = PORTS[port]
  const prefix = style === 'go' ? '// ' : '/// '
  const problems = []
  if (sidecar.revision !== model.revision) problems.push(`${port}: sidecar is for ${String(sidecar.revision).slice(0, 12)}, the model for ${String(model.revision).slice(0, 12)}`)
  const byId = new Map(model.symbols.map((symbol) => [symbol.publicId ?? symbol.id, symbol]))
  for (const [id, { behavior, evidence = {} }] of Object.entries(sidecar.symbols)) {
    const symbol = byId.get(id)
    if (!symbol) { problems.push(`${id}: no such declaration in the model`); continue }
    const lines = []
    const quotes = {}
    for (const [row, record] of Object.entries(evidence)) {
      const fact = behavior[row]
      if (!fact) { problems.push(`${id} ${row}: evidence without a fact`); continue }
      const cited = fact.source.line
      if (record.line !== cited) { problems.push(`${id} ${row}: cites line ${cited}, its evidence is line ${record.line}`); continue }
      lines[cited - 1] = fact.origin === 'signature' ? record.text : prefix + record.text
      if (fact.origin === 'curated') quotes[row] = record.text
    }
    for (const row of Object.keys(behavior)) if (!evidence[row]) problems.push(`${id} ${row}: a fact with no evidence line`)
    for (const problem of verifyBehavior(symbol, behavior, lines, style, quotes)) problems.push(problem)
  }
  return problems
}

/**
 * Regenerate, check or source-bind the sidecars of the named ports (every port when none is named).
 * Returns whether every one of them is sound; the caller turns a `false` into an exit status.
 */
export function run(argv = process.argv.slice(2), {
  dataDir = join(root, 'site/src/data/api'), curatedFile = curatedPath(), checkoutOf = (port) => checkoutOverride(port) ?? home(PORTS[port].checkout),
} = {}) {
  const check = argv.includes('--check')
  const sourceBound = argv.includes('--source-bound')
  const named = argv.filter((arg) => !arg.startsWith('--'))
  const only = named.filter((arg) => PORTS[arg])
  if (sourceBound) {
    if (check || named.length !== 1) throw new Error('gen-api-behavior: --source-bound rewrites one port: name it and do not pass --check')
    // A port whose comments are not read has no sidecar to bring to the model's revision.
    if (!only.length) { console.log(`gen-api-behavior: ${named[0]} has no behaviour extractor; nothing to regenerate`); return true }
  }
  const curated = existsSync(curatedFile) ? JSON.parse(readFileSync(curatedFile, 'utf8')) : {}
  let failed = false
  for (const port of only.length ? only : Object.keys(PORTS)) {
    const model = JSON.parse(readFileSync(join(dataDir, `${port}.json`), 'utf8'))
    const checkout = checkoutOf(port)
    const path = join(dataDir, `${port}.behavior.json`)
    const cache = new Map()
    const linesOf = (file) => {
      if (!cache.has(file)) cache.set(file, pinnedLines(checkout, model.revision, file))
      return cache.get(file)
    }
    if (!linesOf(model.symbols.find((symbol) => symbol.source?.file)?.source.file)) {
      if (sourceBound) throw new Error(`gen-api-behavior: ${port}: no checkout holds ${String(model.revision).slice(0, 12)}, the revision of the model this build renders; the sidecar cannot be paired with it`)
      // No checkout (CI): the committed facts are held to the lines they recorded and to the model's revision.
      if (check && existsSync(path)) {
        const found = verifySidecar(port, JSON.parse(readFileSync(path, 'utf8')), model)
        if (found.length) { console.error(`gen-api-behavior: ${port}: ${found.length} unsound committed facts\n  ${found.slice(0, 10).join('\n  ')}`); failed = true }
        else console.log(`gen-api-behavior: ${port}: no checkout; committed facts match their evidence lines`)
      } else console.log(`gen-api-behavior: ${port}: no checkout holds ${String(model.revision).slice(0, 12)}; set LIBTMUX_DOCS_CHECKOUT_${port.toUpperCase()}. Skipped.`)
      continue
    }
    const { sidecar, problems, dropped } = buildSidecar(port, { model, curated: curated[port], linesOf, tolerant: sourceBound })
    for (const reason of dropped) console.warn(`gen-api-behavior: ${port}: left out: ${reason}`)
    if (problems.length) { console.error(`gen-api-behavior: ${port}: ${problems.length} unsound facts\n  ${problems.slice(0, 10).join('\n  ')}`); failed = true; continue }
    const text = `${JSON.stringify(sidecar, null, 1)}\n`
    if (check) {
      if (!existsSync(path) || readFileSync(path, 'utf8') !== text) { console.error(`gen-api-behavior: ${port}: stale; run node scripts/gen-api-behavior.mjs ${port}`); failed = true }
      else console.log(`gen-api-behavior: ${port}: matches (${Object.keys(sidecar.symbols).length} declarations)`)
    } else {
      writeFileSync(path, text)
      console.log(`gen-api-behavior: ${port}: wrote ${Object.keys(sidecar.symbols).length} declarations at ${String(model.revision).slice(0, 12)}`)
    }
  }
  return !failed
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { if (!run()) process.exit(1) } catch (error) { console.error(error.message); process.exit(1) }
}
