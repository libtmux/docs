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
 * source or generation fails. Symbols that carry a command's name and only
 * build or record it (a plan, a chain, a request) are `exclusions.json`, held
 * to the same standard.
 *
 * The result is `site/src/data/tmux-usage/<port>.json`, keyed by public symbol.
 *
 *   gen-tmux-usage.mjs                regenerate from the port checkouts
 *   gen-tmux-usage.mjs --check        verify shape and revision binding, no checkout
 *   gen-tmux-usage.mjs --check --source   also regenerate and compare
 *   gen-tmux-usage.mjs --report       list the sends no public symbol was credited with
 *   gen-tmux-usage.mjs --data <dir>   read and write another copy of the data directory
 *   gen-tmux-usage.mjs --commands a,b record these commands (or `all`) instead of COMMANDS
 *   gen-tmux-usage.mjs --ports a,b    only these ports, and the core libraries their wrappers stand on
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GRAMMARS, isLibrarySource, scanSource } from './lib/tmux-usage-scan.mjs'
import { applyExclusions, deriveUsage, verifyClaims } from './lib/tmux-usage-derive.mjs'
import { forwardUsage } from './lib/tmux-usage-forward.mjs'
import { libraryScopes, scopeProblems } from './lib/tmux-usage-scopes.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = join(root, 'site/src/data')
const defaultUsageDir = join(dataDir, 'tmux-usage')
const claimsPath = join(root, 'scripts/tmux-usage/claims.json')
const forwardersPath = join(root, 'scripts/tmux-usage/forwarders.json')
const exclusionsPath = join(root, 'scripts/tmux-usage/exclusions.json')
export const SCHEMA_VERSION = 1
/** The commands whose usage is recorded: every command of the pinned manuals, unless `--commands` names some. */
export const COMMANDS = 'all'

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
const commandsFrom = (value) => (value === 'all' ? manualCommands() : value.split(','))
const commandsToRecord = commandsFrom(args.includes('--commands') ? option('--commands') : COMMANDS)

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

/** How a port's symbols find their definitions: Lua's handles share one implementation, Julia's methods share files. */
const DEFINITION_OPTIONS = { lua: { sharedOwner: true }, julia: { freeFunctions: true } }

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
      ...(entry.reviewed ? { reviewed: true } : {}), ...(entry.forwardable ? { forwardable: true } : {}), ...(entry.via ? { via: entry.via } : {}),
    })
  }
  for (const list of Object.values(symbols)) list.sort((a, b) => a.command.localeCompare(b.command) || String(a.scope).localeCompare(String(b.scope)))
  return sortKeys({ schemaVersion: SCHEMA_VERSION, port, repo: model.repo, revision: model.revision, commands: [...commands].sort(), symbols })
}

/** Read a port's source at its pinned revision: every function, and the public symbols that name them. */
async function scanPort({ port, model, commands, checkout, known }) {
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
  return { symbols, functions, types, readSource }
}

/** A reviewed claim stands over what a scan found for the same symbol, command and scope; otherwise the fewer hops win. */
const mergeEntries = (found, entries) => {
  for (const entry of entries) {
    const key = `${entry.symbol}\0${entry.command}\0${entry.scope}`
    const held = found.get(key)
    if (!held || (entry.reviewed && !held.reviewed) || (Boolean(entry.reviewed) === Boolean(held.reviewed) && held.hops > entry.hops)) found.set(key, entry)
  }
}

/** The sends a scan finds in a port's own source, and the reviewed claims that add to them. */
function derivePort({ port, scanned, commands, scopes, claims, report, sends }) {
  const { symbols, functions, types, readSource } = scanned
  const found = new Map()
  const problems = []
  for (const command of commands) {
    const spec = scopes.commands[command] && { scopes: libraryScopes(scopes.commands[command]) }
    const derived = deriveUsage({ command, spec, functions, symbols, definitionOptions: DEFINITION_OPTIONS[port] })
    const reviewed = verifyClaims({
      claims: claims.filter((claim) => claim.port === port && claim.command === command), spec, functions, types, symbols, readSource, definitionOptions: DEFINITION_OPTIONS[port], sends,
    })
    problems.push(...reviewed.problems)
    mergeEntries(found, [...derived.entries, ...reviewed.entries])
    for (const item of derived.unresolved) report.push(`${port} ${command}: ${item.file}:${item.line} in ${item.function}: ${item.reason}`)
  }
  return { found, problems }
}

/** The Operation annotation above the core method that sends, the line that makes a generated wrapper forward to it. */
function operationAnnotation(core, kinds) {
  const pattern = new RegExp(`@Operation\\(\\s*Kind\\.(?:${kinds.join('|')})\\s*\\)`)
  return (entry) => {
    const last = entry.evidence.at(-1)
    const file = last.slice(0, last.lastIndexOf(':'))
    const line = Number(last.slice(last.lastIndexOf(':') + 1))
    const fn = core.functions.find((candidate) => candidate.file === file && candidate.start <= line && line <= candidate.end)
    const text = fn && core.readSource(file)?.split('\n')
    if (!fn || !text) return undefined
    for (let at = fn.start; at <= fn.nameLine; at++) if (pattern.test(text[at - 1] ?? '')) return `${file}:${at}`
    return undefined
  }
}

/** A wrapper's entries: what it sends through the core method it calls, and the lines that show each hop. */
function forwardPort({ port, config, scanned, core, coreScan, readEvidence }) {
  const problems = []
  let generated
  if (config.generated) {
    for (const item of config.generated.evidence) {
      const [file, line] = [item.at.slice(0, item.at.lastIndexOf(':')), Number(item.at.slice(item.at.lastIndexOf(':') + 1))]
      const text = readEvidence(file)?.split('\n')[line - 1]
      if (text === undefined) problems.push(`${port}: forwarder evidence ${item.at} is not a line of the pinned source`)
      for (const needle of item.has ?? []) if (text !== undefined && !text.includes(needle)) problems.push(`${port}: forwarder evidence ${item.at} does not contain ${JSON.stringify(needle)}`)
    }
    generated = { under: config.generated.under, evidence: config.generated.evidence.map((item) => item.at), forwards: operationAnnotation(coreScan, config.generated.kinds) }
  }
  const result = forwardUsage({
    parent: config.parent, functions: scanned.functions, types: scanned.types, symbols: scanned.symbols,
    core: { entries: core.entries, symbols: core.symbols }, generated,
  })
  return { entries: result.entries, problems }
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
  const exclusions = existsSync(exclusionsPath) ? readJson(exclusionsPath).exclusions : []
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

  const forwarders = existsSync(forwardersPath) ? readJson(forwardersPath).forwarders : {}
  /** A wrapper stands on its core library's own result, so cores run first. */
  const only = args.includes('--ports') ? new Set(option('--ports').split(',')) : undefined
  const wanted = (port) => !only || only.has(port.slug) || [...only].some((slug) => forwarders[slug]?.parent === port.slug)
  const ordered = ports.filter(wanted).sort((a, b) => Number(Boolean(forwarders[a.slug])) - Number(Boolean(forwarders[b.slug])))
  const byPort = new Map()
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
    const scanned = await scanPort({ port: port.slug, model, commands: commandsToRecord, checkout, known })
    const sends = (parent, symbol, command, scope) => byPort.get(parent)?.found.get(`${symbol}\0${command}\0${scope}`)
    const { found, problems } = derivePort({ port: port.slug, scanned, commands: commandsToRecord, scopes, claims, report, sends })
    failures.push(...problems)
    const excluded = applyExclusions({ exclusions: exclusions.filter((exclusion) => exclusion.port === port.slug), found, symbols: scanned.symbols, readSource: scanned.readSource })
    failures.push(...excluded.problems)
    const config = forwarders[port.slug]
    if (config) {
      const core = byPort.get(config.parent)
      if (!core) failures.push(`${port.slug}: its core library ${config.parent} was not generated`)
      else {
        const forwarded = forwardPort({
          port: port.slug, config, scanned, coreScan: core.scanned, readEvidence: scanned.readSource,
          core: { entries: [...core.found.values()], symbols: new Map(core.scanned.symbols.map((symbol) => [symbol.id, symbol])) },
        })
        failures.push(...forwarded.problems)
        mergeEntries(found, forwarded.entries)
      }
    }
    byPort.set(port.slug, { found, scanned })
    const document = portDocument(port.slug, model, [...found.values()], commandsToRecord)
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
