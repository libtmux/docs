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

export function sidecarPath(port) { return join(root, `site/src/data/api/${port}.behavior.json`) }
export function curatedPath() { return join(root, 'site/src/data/api-behavior-curated.json') }

/** Build the sidecar of one port from its model, its pinned source and the curated entries. */
export function buildSidecar(port, { model, curated = {}, linesOf }) {
  const { style } = PORTS[port]
  const symbols = {}
  const problems = []
  for (const symbol of model.symbols) {
    const lines = symbol.source?.file ? linesOf(symbol.source.file) : undefined
    if (!lines) continue
    const behavior = extractBehavior(symbol, lines, style) ?? {}
    const quotes = {}
    for (const entry of curated[symbol.publicId ?? symbol.id] ?? []) {
      if (!BEHAVIOR_ROWS.includes(entry.row)) { problems.push(`${symbol.id}: unknown row ${entry.row}`); continue }
      behavior[entry.row] = { text: entry.text, source: { file: symbol.source.file, line: entry.line }, origin: 'curated', ...(entry.via ? { via: entry.via } : {}) }
      quotes[entry.row] = entry.quote
    }
    if (!Object.keys(behavior).length) continue
    const ordered = orderBehavior(behavior)
    for (const problem of verifyBehavior(symbol, ordered, lines, style, quotes)) problems.push(problem)
    const evidence = {}
    for (const row of [...BEHAVIOR_ROWS, 'requires']) {
      const fact = ordered[row]
      if (!fact) continue
      const source = row === 'requires' ? fact.source : fact.source
      evidence[row] = { line: source.line, text: squash((lines[source.line - 1] ?? '').replace(style === 'go' ? /^\s*\/\/ ?/ : /^\s*\/\/\/ ?/, '')) }
    }
    symbols[symbol.publicId ?? symbol.id] = { behavior: ordered, evidence }
  }
  return { sidecar: { port, repo: model.repo, revision: model.revision, symbols }, problems }
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

function run() {
  const check = process.argv.includes('--check')
  const only = process.argv.slice(2).filter((arg) => PORTS[arg])
  const curated = existsSync(curatedPath()) ? JSON.parse(readFileSync(curatedPath(), 'utf8')) : {}
  let failed = false
  for (const port of only.length ? only : Object.keys(PORTS)) {
    const model = JSON.parse(readFileSync(join(root, `site/src/data/api/${port}.json`), 'utf8'))
    const checkout = checkoutOverride(port) ?? home(PORTS[port].checkout)
    const cache = new Map()
    const linesOf = (file) => {
      if (!cache.has(file)) cache.set(file, pinnedLines(checkout, model.revision, file))
      return cache.get(file)
    }
    if (!linesOf(model.symbols.find((symbol) => symbol.source?.file)?.source.file)) {
      // No checkout (CI): the committed facts are held to the lines they recorded and to the model's revision.
      if (check && existsSync(sidecarPath(port))) {
        const found = verifySidecar(port, JSON.parse(readFileSync(sidecarPath(port), 'utf8')), model)
        if (found.length) { console.error(`gen-api-behavior: ${port}: ${found.length} unsound committed facts\n  ${found.slice(0, 10).join('\n  ')}`); failed = true }
        else console.log(`gen-api-behavior: ${port}: no checkout; committed facts match their evidence lines`)
      } else console.log(`gen-api-behavior: ${port}: no checkout holds ${String(model.revision).slice(0, 12)}; set LIBTMUX_DOCS_CHECKOUT_${port.toUpperCase()}. Skipped.`)
      continue
    }
    const { sidecar, problems } = buildSidecar(port, { model, curated: curated[port], linesOf })
    if (problems.length) { console.error(`gen-api-behavior: ${port}: ${problems.length} unsound facts\n  ${problems.slice(0, 10).join('\n  ')}`); failed = true; continue }
    const text = `${JSON.stringify(sidecar, null, 1)}\n`
    const path = sidecarPath(port)
    if (check) {
      if (!existsSync(path) || readFileSync(path, 'utf8') !== text) { console.error(`gen-api-behavior: ${port}: stale; run node scripts/gen-api-behavior.mjs ${port}`); failed = true }
      else console.log(`gen-api-behavior: ${port}: matches (${Object.keys(sidecar.symbols).length} declarations)`)
    } else {
      writeFileSync(path, text)
      console.log(`gen-api-behavior: ${port}: wrote ${Object.keys(sidecar.symbols).length} declarations`)
    }
  }
  if (failed) process.exit(1)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run()
