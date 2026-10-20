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
 * to the same standard. A method whose own name says it sends a command, with
 * no entry for it, is a candidate that a claim or a review in
 * `not-senders.json` must settle, so a miss cannot pass unseen.
 *
 * The result is `site/src/data/tmux-usage/<port>.json`, keyed by public symbol.
 *
 *   gen-tmux-usage.mjs                regenerate from the port checkouts
 *   gen-tmux-usage.mjs --check        verify shape and revision binding, no checkout
 *   gen-tmux-usage.mjs --check --source   also regenerate and compare
 *   gen-tmux-usage.mjs --report       list the sends no public symbol was credited with
 *   gen-tmux-usage.mjs --data <dir>   read and write another copy of the data directory
 *   gen-tmux-usage.mjs --rules <dir>  read another copy of scripts/tmux-usage, the reviewed rules
 *   gen-tmux-usage.mjs --commands a,b record these commands (or `all`) instead of COMMANDS
 *   gen-tmux-usage.mjs --ports a,b    only these ports, and the core libraries their wrappers stand on
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractProject } from '../packages/api-model/src/project.ts'
import { GRAMMARS, isLibrarySource, scanSource } from './lib/tmux-usage-scan.mjs'
import { applyConditions, applyExclusions, conditionProblem, deriveUsage, partialProblems, ruleHolds, verifyClaims } from './lib/tmux-usage-derive.mjs'
import { auditEvidence } from './lib/tmux-usage-audit.mjs'
import { dispatcherProblems, guardProblems } from './lib/tmux-usage-dispatch.mjs'
import { forwardUsage } from './lib/tmux-usage-forward.mjs'
import { settleCandidates, sweepCandidates } from './lib/tmux-usage-sweep.mjs'
import { libraryScopes, scopeProblems } from './lib/tmux-usage-scopes.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = join(root, 'site/src/data')
const defaultUsageDir = join(dataDir, 'tmux-usage')
export const SCHEMA_VERSION = 1
/** The commands whose usage is recorded: every command of the pinned manuals, unless `--commands` names some. */
export const COMMANDS = 'all'

const args = process.argv.slice(2)
const option = (name) => args[args.indexOf(name) + 1]
/** The reviewed rules live beside the generator, unless `--rules` reads another copy of them. */
const rulesDir = args.includes('--rules') ? resolve(option('--rules')) : join(root, 'scripts/tmux-usage')
const claimsPath = join(rulesDir, 'claims.json')
const forwardersPath = join(rulesDir, 'forwarders.json')
const exclusionsPath = join(rulesDir, 'exclusions.json')
const reviewsPath = join(rulesDir, 'not-senders.json')
const dispatchersPath = join(rulesDir, 'dispatchers.json')
const guardsPath = join(rulesDir, 'guards.json')
const conditionsPath = join(rulesDir, 'conditions.json')
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

/** Every spelling of each command a literal may use, name first: `new-window` is also `neww`. */
function commandSpellings() {
  const spellings = new Map()
  for (const version of readJson(join(dataDir, 'tmux/versions.json')).versions) {
    for (const command of readJson(join(dataDir, `tmux/${version.version}.json`)).commands) {
      spellings.set(command.name, [...new Set([...(spellings.get(command.name) ?? [command.name]), ...(command.alias ? [command.alias] : [])])])
    }
  }
  return spellings
}

const sortKeys = (value) => Array.isArray(value) ? value.map(sortKeys)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortKeys(item)])) : value

/** The ports whose handles delegate to another type's public methods through a field, and are credited with what those send. */
const DELEGATING = new Set(['go'])

/** How a port's symbols find their definitions: Lua's handles share one implementation, Julia's methods share files. */
export const DEFINITION_OPTIONS = { lua: { sharedOwner: true }, julia: { freeFunctions: true } }

/** A consumer example declares symbols of its own that the library does not. */
const EXAMPLES = /(?:^|\/)(?:examples?|tests?|benchmarks?|docs?)\//

/**
 * Whether a model symbol is private by its own marks: an underscore name, an underscore module or type around it
 * (`libtmux._internal.control_mode`), a `private` modifier, an internal scope. Dunder names are the language's
 * protocol and stay. The reference orders the same members last, as its private tier.
 */
const UNDERSCORE = /^_(?!_)/
export const isPrivateSymbol = (symbol) => (symbol.name.startsWith('_') && !/^__\w+__$/.test(symbol.name))
  || (symbol.publicId ?? symbol.id).replace(/\(.*$/s, '').split(/[.:#\\/]+/).slice(0, -1).some((segment) => UNDERSCORE.test(segment))
  || Boolean(symbol.modifiers?.includes('private')) || symbol.apiScope === 'internal'

/**
 * The declaration of a signature up to its parameters, without the annotations and attributes in front of it.
 * `pub(crate)` is a visibility, not a call, so it is named before the parameters are cut off.
 */
const declarationOf = (raw) => raw
  .replace(/#!?\[[^\]]*\]\s*/g, '')
  .replace(/@\w+(?:\([^)]*\))?\s*/g, '')
  .replace(/\bpub\((?:crate|super|self|in\s[^)]*)\)/g, 'pub_restricted')
  .split('(')[0]

/**
 * Whether a member is not callable by a library's user, by the visibility its own signature spells: `private`, `protected`,
 * `internal`, `fileprivate` or a restricted `pub`. Java alone leaves the visibility off for the default, so a member of a class
 * declared without `public` is package-private there; a member of an interface is public without saying so, and so is an enum
 * constant. A port whose model carries no signature text keeps the filter of its own extractor.
 */
const NON_PUBLIC = /\b(?:private|protected|internal|fileprivate|pub_restricted)\b/
export const notPublic = (symbol, byId, port) => {
  const raw = symbol.signatures?.[0]?.raw
  if (!raw) return false
  const declaration = declarationOf(raw)
  if (NON_PUBLIC.test(declaration)) return true
  if (port !== 'java' || ['interface', 'enum'].includes(byId.get(symbol.parent)?.kind)) return false
  return !/\bpublic\b/.test(declaration)
}

/** Callable public symbols, in the shape the derivation reads: a library's private helpers are not API to use. */
export function publicSymbols(model) {
  const byId = new Map(model.symbols.map((symbol) => [symbol.id, symbol]))
  return model.symbols
    .filter((symbol) => !isPrivateSymbol(symbol) && !notPublic(symbol, byId, model.port) && symbol.source?.file && !EXAMPLES.test(symbol.source.file)
      && ['function', 'method', 'property', 'attribute'].includes(symbol.kind))
    .map((symbol) => ({
      id: symbol.publicId ?? symbol.id,
      name: symbol.name,
      qualified: symbol.qualifiedName,
      parentName: symbol.parent ? byId.get(symbol.parent)?.name : undefined,
      file: symbol.source.file,
      line: symbol.source.line ?? 0,
      kind: symbol.kind,
      overloaded: symbol.modifiers?.includes('overload'),
    }))
}

export function portDocument(port, model, found, commands) {
  const symbols = {}
  for (const entry of found) {
    ;(symbols[entry.symbol] ??= []).push({
      command: entry.command, scope: entry.scope, evidence: entry.evidence,
      ...(entry.reviewed ? { reviewed: true } : {}), ...(entry.forwardable ? { forwardable: true } : {}), ...(entry.incidental ? { incidental: true } : {}), ...(entry.when ? { when: entry.when } : {}), ...(entry.via ? { via: entry.via } : {}),
    })
  }
  for (const list of Object.values(symbols)) list.sort((a, b) => a.command.localeCompare(b.command) || String(a.scope).localeCompare(String(b.scope)))
  return sortKeys({ schemaVersion: SCHEMA_VERSION, port, repo: model.repo, revision: model.revision, commands: [...commands].sort(), symbols })
}

/** Read a port's source at its pinned revision: every function, and the public symbols that name them. */
export async function scanPort({ port, model, commands, checkout, known, dispatch, builders, guards, labels, trace }) {
  const grammar = GRAMMARS[port]
  const symbols = publicSymbols(model)
  const functions = []
  const types = []
  const sources = grammar ? librarySources(checkout, model.revision, grammar) : new Map()
  const wanted = new Set(commands)
  for (const [path, text] of sources) {
    const scanned = await scanSource({ grammar, text, commands: wanted, known, dispatch, builders, guards, labels, trace })
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

/**
 * Where a core library keeps the source its public symbols come from, for reading it at another revision than its model.
 * Only a core that a wrapper shares a repository with, and is pinned apart from, needs this.
 */
const CORE_EXTRACTION = { csharp: { roots: ['src/LibTmux'], options: { inheritedMembers: true } } }

/** The public symbols of a core library as they were at a revision, extracted from that revision's own files. */
async function modelAtRevision({ port, checkout, revision }) {
  const config = CORE_EXTRACTION[port]
  if (!config) throw new Error(`${port}: no source roots are configured to read its symbols at ${revision.slice(0, 8)}`)
  const dir = mkdtempSync(join(tmpdir(), 'tmux-usage-'))
  try {
    const unpacked = spawnSync('tar', ['-x', '-C', dir], { input: git(checkout, 'archive', revision, ...config.roots), maxBuffer: 1 << 28 })
    if (unpacked.status !== 0) throw new Error(`${port}: cannot unpack ${revision.slice(0, 8)}: ${unpacked.stderr}`)
    const model = await extractProject({ port, root: join(dir, config.roots[0]), roots: config.roots.map((root) => join(dir, root)), revision, options: config.options })
    for (const symbol of model.symbols) if (symbol.source?.file?.startsWith(`${dir}/`)) symbol.source.file = symbol.source.file.slice(dir.length + 1)
    return model
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** The Operation annotation above the core method that sends, the line that makes a generated wrapper forward to it. */
function operationAnnotation(core, kinds) {
  const pattern = new RegExp(`@Operation\\(\\s*Kind\\.(?:${kinds.join('|')})\\s*\\)`)
  return (entry, symbol) => {
    // The method a wrapper forwards to is the public one the entry belongs to; the lines it cites may be in a helper.
    const name = symbol?.name.replace(/\(.*$/s, '')
    const candidates = core.functions.filter((fn) => symbol && fn.file === symbol.file && fn.name === name && fn.start <= (symbol.line ?? 0) + 2 && (symbol.line ?? 0) <= fn.end)
    for (const fn of candidates.length ? candidates : core.functions.filter((other) => symbol && other.file === symbol.file && other.name === name)) {
      const text = core.readSource(fn.file)?.split('\n')
      for (let at = fn.start; text && at <= fn.nameLine; at++) if (pattern.test(text[at - 1] ?? '')) return `${fn.file}:${at}`
    }
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
    core: { entries: core.entries, symbols: core.symbols, revision: core.revision }, generated,
  })
  return { entries: result.entries, problems }
}

/** Ports that have a model, in the order the site lists them. */
export async function portsWithModels() {
  const { PORTS } = await import(`file://${join(root, 'site/src/lib/ports.ts')}`)
  return PORTS.filter((port) => existsSync(join(dataDir, `api/${port.slug}.json`)))
}

export function checkoutFor(port) {
  const override = process.env[`LIBTMUX_DOCS_CHECKOUT_${port.slug.toUpperCase()}`]
  return expand(override || port.checkout)
}

/**
 * The revision a wrapper's cited core lines are read at: the wrapper's own when it shares a repository with the core
 * library, because the two are built together there, and the core's model otherwise, which is the release the wrapper
 * depends on. A wrapper with no core library cites none.
 */
export const viaRevisionFor = (model, coreModel) => (coreModel ? (coreModel.repo === model.repo ? model.revision : coreModel.revision) : undefined)

/** What a committed file must satisfy without any checkout. */
export function documentProblems(document, model, scopes, commands, viaRevision) {
  const problems = []
  if (document.schemaVersion !== SCHEMA_VERSION) problems.push(`schemaVersion ${document.schemaVersion}`)
  if (document.revision !== model.revision) problems.push(`records ${document.revision}, but the API model is at ${model.revision}`)
  if (JSON.stringify(document.commands) !== JSON.stringify([...commands].sort())) problems.push(`covers ${JSON.stringify(document.commands)}, expected ${JSON.stringify([...commands].sort())}`)
  const ids = new Set(model.symbols.map((symbol) => symbol.publicId ?? symbol.id))
  const byId = new Map(model.symbols.map((symbol) => [symbol.id, symbol]))
  const privateIds = new Set(model.symbols.filter((symbol) => isPrivateSymbol(symbol) || notPublic(symbol, byId, model.port)).map((symbol) => symbol.publicId ?? symbol.id))
  for (const [symbol, uses] of Object.entries(document.symbols)) {
    if (!ids.has(symbol)) problems.push(`${symbol}: not a symbol of the API model`)
    else if (privateIds.has(symbol)) problems.push(`${symbol}: is private or package-private, and only public API is recorded`)
    for (const use of uses) {
      const scoped = scopes.commands[use.command]?.scopes
      if (!commands.includes(use.command)) problems.push(`${symbol}: ${use.command} is not a recorded command`)
      if (scoped ? !scoped.some((scope) => scope.id === use.scope) : use.scope !== null) problems.push(`${symbol}: ${use.scope} is not a scope of ${use.command}`)
      if (!use.evidence?.length || use.evidence.some((item) => !/^[^:\s][^:]*:\d+$/.test(item))) problems.push(`${symbol}: evidence must be file:line`)
      const wrong = conditionProblem(use.when, false)
      if (wrong) problems.push(`${symbol}: ${use.command} ${wrong}`)
      if (use.via) {
        if (!use.via.evidence?.length || use.via.evidence.some((item) => !/^[^:\s][^:]*:\d+$/.test(item))) problems.push(`${symbol}: via evidence must be file:line`)
        // The lines of a core library are read where the wrapper is pinned when both live in one repository, and where the core's own model is otherwise.
        const expected = use.via.port === model.port ? model.revision : viaRevision
        if (use.via.revision !== expected) problems.push(`${symbol}: via ${use.via.symbol} cites ${use.via.port} lines at ${use.via.revision ?? 'no revision'}, which must be ${expected ?? 'absent, for a port with no core library'}`)
      }
    }
  }
  return problems
}

/** The methods named for a command that nothing credits, and the reviews that no longer hold. */
function sweepProblems({ port, model, document, reviews, exclusions, report, readSource }) {
  const has = new Set(Object.entries(document.symbols).flatMap(([symbol, uses]) => uses.map((use) => `${symbol}\0${use.command}`)))
  const { candidates } = sweepCandidates({ port, commands: document.commands, symbols: publicSymbols(model), has })
  const { unreviewed, problems } = settleCandidates({
    port, candidates, reviews: reviews.filter((review) => review.port === port), readSource,
    // An exclusion settles the builders it removed, and is held to its own evidence elsewhere.
    covering: exclusions.filter((exclusion) => exclusion.port === port),
  })
  for (const candidate of unreviewed) report.push(`${port} sweep ${candidate.command}: ${candidate.symbol}`)
  if (unreviewed.length) {
    const shown = unreviewed.slice(0, 6).map((candidate) => `${candidate.symbol.split('.').slice(-2).join('.')} (${candidate.command})`).join(', ')
    problems.push(`${port}: ${unreviewed.length} methods named for a command have no entry for it and no review: ${shown}${unreviewed.length > 6 ? ', ...' : ''}`)
  }
  return problems
}

export { dispatcherProblems, guardProblems }

export async function main() {
  const scopes = readJson(join(usageDir, 'scopes.json'))
  const claims = existsSync(claimsPath) ? readJson(claimsPath).claims : []
  const exclusions = existsSync(exclusionsPath) ? readJson(exclusionsPath).exclusions : []
  const reviews = existsSync(reviewsPath) ? readJson(reviewsPath).reviews : []
  const dispatchers = existsSync(dispatchersPath) ? readJson(dispatchersPath).dispatchers : []
  const guards = existsSync(guardsPath) ? readJson(guardsPath).guards : []
  const conditions = existsSync(conditionsPath) ? readJson(conditionsPath).conditions : []
  const ports = await portsWithModels()
  const report = []
  const failures = []
  const known = regenerate ? knownCommands() : new Set()
  const spellings = commandSpellings()
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
  const models = new Map(ports.map((port) => [port.slug, readJson(join(dataDir, `api/${port.slug}.json`))]))
  const viaRevisionOf = (slug) => viaRevisionFor(models.get(slug), forwarders[slug] && models.get(forwarders[slug].parent))

  /** Every scan made, by port and revision, for the audit to read the lines an entry cites from. */
  const scans = new Map()
  const scanKey = (slug, revision) => `${slug}@${revision}`
  /** A port's result at its model's revision, and a core library's at the revision a wrapper in its repository is pinned at. */
  const passes = new Map()

  /** Scan a port's library at a revision and derive what it sends, from the scan and the claims and exclusions that hold there. */
  async function derivePass({ port, model, core }) {
    const pinned = models.get(port.slug).revision
    const rules = (list) => list.filter((rule) => rule.port === port.slug && ruleHolds(rule, model.revision, pinned))
    // A dispatch API is a name, so it holds at any revision of its port; its definition is checked at the model's.
    const apis = dispatchers.filter((api) => api.port === port.slug && (!api.revision || model.revision.startsWith(api.revision)))
    const wrappers = guards.filter((guard) => guard.port === port.slug)
    const scanned = await scanPort({
      port: port.slug, model, commands: commandsToRecord, checkout: checkoutFor(port), known,
      dispatch: new Set(apis.filter((api) => api.kind !== 'builder').map((api) => api.name)), builders: new Set(apis.filter((api) => api.kind === 'builder').map((api) => api.name)),
      guards: wrappers.map(({ name, owner }) => ({ name, owner })),
      labels: new Map(apis.filter((api) => api.labels?.length).map((api) => [api.name, new Set(api.labels.map((label) => label.at))])),
    })
    scans.set(scanKey(port.slug, model.revision), { read: scanned.readSource, functions: scanned.functions })
    const dispatchProblems = model.revision === pinned
      ? [...dispatcherProblems({ port: port.slug, dispatchers: apis, readSource: scanned.readSource, functions: scanned.functions }),
        ...guardProblems({ port: port.slug, guards: wrappers, readSource: scanned.readSource, functions: scanned.functions })] : []
    const sends = (parent, symbol, command, scope) => {
      const entry = core?.found.get(`${symbol}\0${command}\0${scope}`)
      return parent === core?.port && entry ? { ...entry, revision: core.revision } : undefined
    }
    const { found, problems } = derivePort({ port: port.slug, scanned, commands: commandsToRecord, scopes, claims: rules(claims), report, sends })
    const excluded = applyExclusions({ exclusions: rules(exclusions), found, symbols: scanned.symbols, readSource: scanned.readSource })
    return { port: port.slug, revision: model.revision, found, scanned, problems: [...dispatchProblems, ...problems, ...excluded.problems] }
  }

  /** The core library as the wrapper sees it: read where the wrapper is pinned if they share a repository, else at the core's model. */
  async function corePassFor(port, config) {
    const parent = ports.find((candidate) => candidate.slug === config.parent)
    const revision = viaRevisionOf(port.slug)
    if (revision === models.get(parent.slug).revision) return passes.get(parent.slug)
    const key = scanKey(parent.slug, revision)
    if (!passes.has(key)) {
      const model = await modelAtRevision({ port: parent.slug, checkout: checkoutFor(parent), revision })
      const pass = await derivePass({ port: parent, model, core: undefined })
      failures.push(...pass.problems)
      passes.set(key, pass)
    }
    return passes.get(key)
  }

  const claimFor = (slug, symbol, command, scope, revision) => claims.find((claim) => claim.port === slug && claim.symbol === symbol
    && claim.command === command && claim.scope === scope && ruleHolds(claim, revision, models.get(slug).revision))

  let compared = 0
  for (const port of ordered) {
    const model = models.get(port.slug)
    const path = join(usageDir, `${port.slug}.json`)
    let committed
    if (check) {
      if (!existsSync(path)) { failures.push(`${port.slug}: no ${path}`); continue }
      committed = readJson(path)
      for (const problem of documentProblems(committed, model, scopes, commandsToRecord, viaRevisionOf(port.slug))) failures.push(`${port.slug}: ${problem}`)
      if (!args.includes('--source')) {
        failures.push(...sweepProblems({ port: port.slug, model, document: committed, reviews, exclusions, report }))
        continue
      }
    }
    const checkout = checkoutFor(port)
    if (!existsSync(join(checkout, '.git')) && !existsSync(join(checkout, 'HEAD'))) {
      if (check) { console.log(`gen-tmux-usage: ${port.slug}: no checkout at ${checkout}; skipped regeneration`); continue }
      throw new Error(`${port.slug}: no checkout at ${checkout}; set LIBTMUX_DOCS_CHECKOUT_${port.slug.toUpperCase()}`)
    }
    const config = forwarders[port.slug]
    const core = config ? await corePassFor(port, config) : undefined
    if (config && !core) failures.push(`${port.slug}: its core library ${config.parent} was not generated`)
    const pass = await derivePass({ port, model, core })
    const { found, scanned } = pass
    failures.push(...pass.problems)
    if (config && core) {
      const forwarded = forwardPort({
        port: port.slug, config, scanned, coreScan: core.scanned, readEvidence: scanned.readSource,
        core: { entries: [...core.found.values()], symbols: new Map(core.scanned.symbols.map((symbol) => [symbol.id, symbol])), revision: core.revision },
      })
      failures.push(...forwarded.problems)
      mergeEntries(found, forwarded.entries)
    }
    const qualifiers = conditions.filter((item) => item.port === port.slug)
    applyConditions({ conditions: qualifiers, found, readSource: scanned.readSource, lenient: true })
    // Go keeps one handle per tmux object and delegates to the server's methods, so a method that calls one on its `server` field sends what it sends.
    if (DELEGATING.has(port.slug)) {
      const delegated = forwardUsage({
        parent: port.slug, delegate: true, functions: scanned.functions, types: scanned.types, symbols: scanned.symbols,
        core: { entries: [...found.values()], symbols: new Map(scanned.symbols.map((symbol) => [symbol.id, symbol])), revision: model.revision },
      })
      mergeEntries(found, delegated.entries)
    }
    passes.set(port.slug, pass)
    // A wrapper forwards what it reads from its core's entries, so the core's conditions are in place before it runs.
    failures.push(...applyConditions({ conditions: qualifiers, found, readSource: scanned.readSource }))
    // A generic function's methods are not credited with each other's sends.
    if (DEFINITION_OPTIONS[port.slug]?.freeFunctions) failures.push(...partialProblems(found).map((problem) => `${port.slug}: ${problem}`))
    const document = portDocument(port.slug, model, [...found.values()], commandsToRecord)
    failures.push(...sweepProblems({ port: port.slug, model, document, reviews, exclusions, report, readSource: scanned.readSource }))
    // The committed entries are the ones audited, because a check has to read what is published and not what a scan makes of it.
    const subject = committed ?? document
    failures.push(...auditEvidence({
      port: port.slug, revision: model.revision, claimFor, spellings: (command) => spellings.get(command) ?? [command],
      sourcesAt: (slug, revision) => scans.get(scanKey(slug, revision)),
      dispatchFor: (slug) => new Set(dispatchers.filter((api) => api.port === slug && api.kind !== 'builder').map((api) => api.name)),
      generated: config?.generated && { evidence: config.generated.evidence.map((item) => item.at) },
      uses: Object.entries(subject.symbols).flatMap(([symbol, uses]) => uses.map((use) => ({ symbol, ...use }))),
    }))
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
