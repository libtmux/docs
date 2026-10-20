#!/usr/bin/env node
/**
 * Record which public symbols of each library send each tmux command.
 *
 * Every port's source is read at the revision its API model was extracted
 * from. A send site is a command-name literal in code, with the flags written
 * beside it; the scope those flags select decides which of the command's C
 * functions the symbol answers. Sends a scan cannot see (a command named by a
 * template, a scope passed as a typed argument) are reviewed claims in
 * `scripts/tmux-usage/claims.json`; each one must still be true of the pinned
 * source or generation fails.
 *
 * The result is `site/src/data/tmux-usage/<port>.json`, keyed by public symbol.
 *
 *   gen-tmux-usage.mjs                regenerate from the port checkouts
 *   gen-tmux-usage.mjs --check        verify shape and revision binding, no checkout
 *   gen-tmux-usage.mjs --check --source   also regenerate and compare
 *   gen-tmux-usage.mjs --report       list the sends no public symbol was credited with
 *   gen-tmux-usage.mjs --data <dir>   read and write another copy of the data directory
 *   gen-tmux-usage.mjs --commands a,b record these commands (or `all`) instead of COMMANDS
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GRAMMARS, isLibrarySource, scanSource } from './lib/tmux-usage-scan.mjs'
import { deriveUsage, verifyClaims } from './lib/tmux-usage-derive.mjs'
import { libraryScopes, scopeProblems } from './lib/tmux-usage-scopes.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = join(root, 'site/src/data')
const defaultUsageDir = join(dataDir, 'tmux-usage')
const claimsPath = join(root, 'scripts/tmux-usage/claims.json')
export const SCHEMA_VERSION = 1
/** The commands whose usage is recorded; the rollout adds names here. */
export const COMMANDS = ['list-panes']

const args = process.argv.slice(2)
const option = (name) => args[args.indexOf(name) + 1]
const check = args.includes('--check')
const regenerate = !check || args.includes('--source')
const usageDir = args.includes('--data') ? resolve(option('--data')) : defaultUsageDir

// The Swift grammar is a very large WASM module; V8's optimizing tier runs out of memory compiling it.
if (regenerate && !process.execArgv.includes('--liftoff-only') && import.meta.url === `file://${process.argv[1]}`) {
  const child = spawnSync(process.execPath, ['--liftoff-only', ...process.argv.slice(1)], { stdio: 'inherit' })
  process.exit(child.status ?? 1)
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const expand = (path) => (path.startsWith('~/') ? join(homedir(), path.slice(2)) : path)
const manualCommands = () => [...new Set(readJson(join(dataDir, 'tmux/versions.json')).versions.flatMap(({ version }) =>
  readJson(join(dataDir, `tmux/${version}.json`)).commands.map((command) => command.name)))].sort()
const commandsToRecord = !args.includes('--commands') ? COMMANDS
  : option('--commands') === 'all' ? manualCommands() : option('--commands').split(',')

function git(checkout, ...gitArgs) {
  const result = spawnSync('git', ['-C', checkout, ...gitArgs], { maxBuffer: 1 << 30 })
  if (result.status !== 0) throw new Error(`git ${gitArgs.join(' ')} in ${checkout}: ${result.stderr}`)
  return result.stdout
}

/** Every file of the revision that is library source, keyed by path. */
function librarySources(checkout, revision, grammar) {
  const listing = git(checkout, 'ls-tree', '-r', revision).toString('utf8').split('\n').filter(Boolean)
    .map((line) => { const [meta, path] = line.split('\t'); return { sha: meta.split(' ')[2], path } })
    .filter((entry) => isLibrarySource(entry.path, grammar))
  const blobs = spawnSync('git', ['-C', checkout, 'cat-file', '--batch'], { input: `${listing.map((entry) => entry.sha).join('\n')}\n`, maxBuffer: 1 << 30 }).stdout
  const files = new Map()
  let position = 0
  for (const entry of listing) {
    const newline = blobs.indexOf(10, position)
    const size = Number(blobs.subarray(position, newline).toString().split(' ')[2])
    files.set(entry.path, blobs.subarray(newline + 1, newline + 1 + size).toString('utf8'))
    position = newline + 1 + size + 1
  }
  return files
}

/** The tmux commands and aliases a literal may spell, from every pinned manual. */
function knownCommands() {
  const names = new Set()
  for (const version of readJson(join(dataDir, 'tmux/versions.json')).versions) {
    for (const command of readJson(join(dataDir, `tmux/${version.version}.json`)).commands) {
      names.add(command.name)
      if (command.alias) names.add(command.alias)
    }
  }
  return names
}

const sortKeys = (value) => Array.isArray(value) ? value.map(sortKeys)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortKeys(item)])) : value

/** A consumer example declares symbols of its own that the library does not. */
const EXAMPLES = /(?:^|\/)(?:examples?|tests?|benchmarks?|docs?)\//

/** Callable public symbols, in the shape the derivation reads. */
function publicSymbols(model) {
  const byId = new Map(model.symbols.map((symbol) => [symbol.id, symbol]))
  return model.symbols
    .filter((symbol) => symbol.apiScope !== 'internal' && symbol.source?.file && !EXAMPLES.test(symbol.source.file)
      && ['function', 'method', 'property', 'attribute'].includes(symbol.kind))
    .map((symbol) => ({
      id: symbol.publicId ?? symbol.id,
      name: symbol.name,
      qualified: symbol.qualifiedName,
      parentName: symbol.parent ? byId.get(symbol.parent)?.name : undefined,
      file: symbol.source.file,
      line: symbol.source.line ?? 0,
      overloaded: symbol.modifiers?.includes('overload'),
    }))
}

export function portDocument(port, model, found, commands) {
  const symbols = {}
  for (const entry of found) {
    ;(symbols[entry.symbol] ??= []).push({
      command: entry.command, scope: entry.scope, evidence: entry.evidence,
      ...(entry.reviewed ? { reviewed: true } : {}), ...(entry.via ? { via: entry.via } : {}),
    })
  }
  for (const list of Object.values(symbols)) list.sort((a, b) => a.command.localeCompare(b.command) || String(a.scope).localeCompare(String(b.scope)))
  return sortKeys({ schemaVersion: SCHEMA_VERSION, port, repo: model.repo, revision: model.revision, commands: [...commands].sort(), symbols })
}

async function derivePort({ port, model, commands, scopes, claims, checkout, known, report, sends }) {
  const grammar = GRAMMARS[port]
  const symbols = publicSymbols(model)
  const functions = []
  const types = []
  const sources = grammar ? librarySources(checkout, model.revision, grammar) : new Map()
  const wanted = new Set(commands)
  for (const [path, text] of sources) {
    const scanned = await scanSource({ grammar, text, commands: wanted, known })
    for (const fn of scanned.functions) functions.push({ ...fn, file: path })
    for (const type of scanned.types) types.push({ ...type, file: path })
  }
  const cache = new Map()
  const readSource = (path) => {
    if (sources.has(path)) return sources.get(path)
    if (!cache.has(path)) {
      const result = spawnSync('git', ['-C', checkout, 'show', `${model.revision}:${path}`], { maxBuffer: 1 << 28 })
      cache.set(path, result.status === 0 ? result.stdout.toString('utf8') : undefined)
    }
    return cache.get(path)
  }
  const found = new Map()
  const problems = []
  for (const command of commands) {
    const spec = scopes.commands[command] && { scopes: libraryScopes(scopes.commands[command]) }
    const derived = deriveUsage({ command, spec, functions, symbols })
    const reviewed = verifyClaims({
      claims: claims.filter((claim) => claim.port === port && claim.command === command), spec, functions, types, symbols, readSource, sends,
    })
    problems.push(...reviewed.problems)
    for (const entry of [...derived.entries, ...reviewed.entries]) {
      const key = `${entry.symbol}\0${entry.command}\0${entry.scope}`
      if (!found.has(key) || found.get(key).hops > entry.hops) found.set(key, entry)
    }
    for (const item of derived.unresolved) report.push(`${port} ${command}: ${item.file}:${item.line} in ${item.function}: ${item.reason}`)
  }
  return { found: [...found.values()], problems }
}

/** Ports that have a model, in the order the site lists them. */
async function portsWithModels() {
  const { PORTS } = await import(`file://${join(root, 'site/src/lib/ports.ts')}`)
  return PORTS.filter((port) => existsSync(join(dataDir, `api/${port.slug}.json`)))
}

function checkoutFor(port) {
  const override = process.env[`LIBTMUX_DOCS_CHECKOUT_${port.slug.toUpperCase()}`]
  return expand(override || port.checkout)
}

/** What a committed file must satisfy without any checkout. */
export function documentProblems(document, model, scopes, commands) {
  const problems = []
  if (document.schemaVersion !== SCHEMA_VERSION) problems.push(`schemaVersion ${document.schemaVersion}`)
  if (document.revision !== model.revision) problems.push(`records ${document.revision}, but the API model is at ${model.revision}`)
  if (JSON.stringify(document.commands) !== JSON.stringify([...commands].sort())) problems.push(`covers ${JSON.stringify(document.commands)}, expected ${JSON.stringify([...commands].sort())}`)
  const ids = new Set(model.symbols.map((symbol) => symbol.publicId ?? symbol.id))
  for (const [symbol, uses] of Object.entries(document.symbols)) {
    if (!ids.has(symbol)) problems.push(`${symbol}: not a symbol of the API model`)
    for (const use of uses) {
      const scoped = scopes.commands[use.command]?.scopes
      if (!commands.includes(use.command)) problems.push(`${symbol}: ${use.command} is not a recorded command`)
      if (scoped ? !scoped.some((scope) => scope.id === use.scope) : use.scope !== null) problems.push(`${symbol}: ${use.scope} is not a scope of ${use.command}`)
      if (!use.evidence?.length || use.evidence.some((item) => !/^[^:\s][^:]*:\d+$/.test(item))) problems.push(`${symbol}: evidence must be file:line`)
    }
  }
  return problems
}

export async function main() {
  const scopes = readJson(join(usageDir, 'scopes.json'))
  const claims = existsSync(claimsPath) ? readJson(claimsPath).claims : []
  const ports = await portsWithModels()
  const report = []
  const failures = []
  const known = regenerate ? knownCommands() : new Set()
  mkdirSync(usageDir, { recursive: true })

  for (const command of commandsToRecord) {
    if (!scopes.commands[command]) continue
    const versions = readJson(join(dataDir, 'tmux/versions.json')).versions
    const tmuxCheckout = process.env.LIBTMUX_DOCS_CHECKOUT_TMUX && expand(process.env.LIBTMUX_DOCS_CHECKOUT_TMUX)
    for (const { version } of versions) {
      const model = readJson(join(dataDir, `tmux/api/${version}.json`))
      const read = tmuxCheckout && existsSync(tmuxCheckout)
        ? (file) => spawnSync('git', ['-C', tmuxCheckout, 'show', `${model.revision}:${file}`], { maxBuffer: 1 << 26 }).stdout.toString('utf8') : undefined
      for (const problem of scopeProblems(scopes.commands[command], model, command, read)) failures.push(`tmux ${version}: ${problem}`)
    }
  }

  /** A wrapper's claim stands on its parent library's own result, so parents run first. */
  const byPort = new Map()
  const sends = (port, symbol, command, scope) => byPort.get(port)?.some((entry) => entry.symbol === symbol && entry.command === command && entry.scope === scope) ?? false
  const ordered = [...ports].sort((a, b) => Number(Boolean(a.parentLibrary)) - Number(Boolean(b.parentLibrary)))
    .sort((a, b) => Number(claims.some((claim) => claim.port === a.slug && claim.via)) - Number(claims.some((claim) => claim.port === b.slug && claim.via)))
  let compared = 0
  for (const port of ordered) {
    const model = readJson(join(dataDir, `api/${port.slug}.json`))
    const path = join(usageDir, `${port.slug}.json`)
    if (check) {
      if (!existsSync(path)) { failures.push(`${port.slug}: no ${path}`); continue }
      const committed = readJson(path)
      for (const problem of documentProblems(committed, model, scopes, commandsToRecord)) failures.push(`${port.slug}: ${problem}`)
      if (!args.includes('--source')) continue
    }
    const checkout = checkoutFor(port)
    if (!existsSync(join(checkout, '.git')) && !existsSync(join(checkout, 'HEAD'))) {
      if (check) { console.log(`gen-tmux-usage: ${port.slug}: no checkout at ${checkout}; skipped regeneration`); continue }
      throw new Error(`${port.slug}: no checkout at ${checkout}; set LIBTMUX_DOCS_CHECKOUT_${port.slug.toUpperCase()}`)
    }
    const { found, problems } = await derivePort({ port: port.slug, model, commands: commandsToRecord, scopes, claims, checkout, known, report, sends })
    byPort.set(port.slug, found)
    failures.push(...problems)
    const document = portDocument(port.slug, model, found, commandsToRecord)
    const text = `${JSON.stringify(document, null, 2)}\n`
    if (check) {
      if (text !== readFileSync(path, 'utf8')) failures.push(`${port.slug}: stale; run node scripts/gen-tmux-usage.mjs`)
      compared++
    } else {
      writeFileSync(path, text)
      console.log(`gen-tmux-usage: ${port.slug}: ${Object.keys(document.symbols).length} symbols at ${model.revision.slice(0, 8)}`)
    }
  }
  if (args.includes('--report')) console.log(report.join('\n'))
  if (failures.length) {
    console.error(failures.map((failure) => `gen-tmux-usage: ${failure}`).join('\n'))
    process.exitCode = 1
    return
  }
  if (check) console.log(`gen-tmux-usage: ${ports.length} ports fresh${compared ? ` (${compared} regenerated and compared)` : ' (shape and revisions only; pass --source to regenerate)'}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
