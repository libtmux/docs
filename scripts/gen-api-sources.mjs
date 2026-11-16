#!/usr/bin/env node
/**
 * Cache the source files each API model cites, at the revision the model records.
 *
 * The reference links a declaration to its file and line. This keeps the bytes
 * of exactly those files, per port, so the site can show them on its own pages
 * and in the source pane without reading a branch head when a reader looks.
 * Files are read with `git show <revision>:<file>`, so a dirty working tree or
 * a later HEAD changes nothing; the cache stores a sha256 beside each file and
 * a stale or damaged entry fails `--check`.
 *
 * A port whose checkout or revision is not on this machine keeps its committed
 * cache and says so; it is never an error to lack a checkout.
 *
 * `--source-bound` is for a build that has just regenerated this port's model
 * from a verified checkout (`scripts/build-site.sh`). The model then names a
 * revision the committed cache was not made for, so the cache is rewritten
 * from that checkout, and a cited file no checkout can supply is an error
 * rather than a skip: the page must not show another revision's bytes beside
 * this model's line numbers.
 *
 * Usage: node scripts/gen-api-sources.mjs [--check] [--port go [--source-bound]]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { citedFiles } from '../packages/api-model/src/cited-files.ts'
import { checkoutCandidates } from './lib/port-checkout.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_MODELS = join(root, 'site/src/data/api')
const DEFAULT_OUT = join(root, 'site/src/data/api-sources')

const digest = (content) => createHash('sha256').update(content).digest('hex')

export { citedFiles }

/** A relative path inside a repository: no escape, no query, no hidden separator. */
export const isCanonicalPath = (file) => typeof file === 'string' && file !== '' && !file.startsWith('/')
  && !/[\\?#%\0\n\r]/.test(file) && !/^[a-z]:/i.test(file)
  && file.split('/').every((part) => part !== '' && part !== '.' && part !== '..')

/** Python's workspace manager and MCP server are packages of other repositories. */
const REPO_CHECKOUTS = {
  'tmux-python/tmuxp': { variable: 'LIBTMUX_DOCS_WORKSPACE_PY', fallback: '~/work/python/tmuxp' },
  'tmux-python/libtmux-mcp': { variable: 'LIBTMUX_DOCS_MCP_PY', fallback: '~/work/python/libtmux-mcp' },
}

const expand = (p) => (p.startsWith('~/') ? join(process.env.HOME ?? '', p.slice(2)) : p)

/** Local checkouts that may hold a port's revision, best first. */
export function checkoutsFor(port, repo, options = {}) {
  const found = []
  const push = (path) => { if (path) found.push(expand(path)) }
  const product = REPO_CHECKOUTS[repo]
  if (product) push(process.env[product.variable] || product.fallback)
  try { found.push(...checkoutCandidates(port, { order: ['worktree', 'checkout'], ...options })) } catch { /* a slug outside ports.ts */ }
  return [...new Set(found)].filter((path) => existsSync(join(path, '.git')))
}

const git = (checkout, ...args) => execFileSync('git', ['-C', checkout, ...args], {
  encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
})

/** The checkout that holds `revision`, if any. */
export function checkoutHolding(checkouts, revision) {
  return checkouts.find((checkout) => {
    try { git(checkout, 'cat-file', '-e', `${revision}^{commit}`); return true } catch { return false }
  })
}

/** Committed text of a file at a revision, or undefined when the revision has no such text file. */
export function committedText(checkout, revision, file) {
  try {
    const content = git(checkout, 'show', `${revision}:${file}`)
    return content.includes('\0') || content.includes('�') ? undefined : content
  } catch { return undefined }
}

/** A cached entry that still describes its bytes and names the revision asked for. */
export function verifiedEntry(entry, { repo, revision }) {
  return entry && entry.repo === repo && entry.revision === revision
    && typeof entry.content === 'string' && entry.sha256 === digest(entry.content)
}

/**
 * Cache one port. Returns the data file's value and what could not be cached.
 * A cited file is read from a checkout holding its revision, else kept from
 * the committed cache when that verifies, else skipped.
 */
export function cachePort(port, model, previous, { checkouts = (repo) => checkoutsFor(port, repo) } = {}) {
  const files = {}
  const unavailable = []
  const absent = []
  const generated = new Set(Object.keys(model.generatedSources ?? {}))
  const holding = new Map()
  for (const [file, { repo, revision }] of [...citedFiles(model)].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (generated.has(file)) continue
    if (!isCanonicalPath(file)) { absent.push(file); continue }
    const key = `${repo}@${revision}`
    if (!holding.has(key)) holding.set(key, checkoutHolding(checkouts(repo), revision))
    const checkout = holding.get(key)
    if (checkout) {
      const content = committedText(checkout, revision, file)
      if (content === undefined) { absent.push(file); continue }
      files[file] = { repo, revision, sha256: digest(content), content }
    } else if (verifiedEntry(previous?.files?.[file], { repo, revision })) {
      files[file] = previous.files[file]
    } else {
      unavailable.push(file)
    }
  }
  const data = { port, ...(generated.size ? { generated: [...generated].sort() } : {}), files }
  return { data, unavailable, absent }
}

/** Why a committed data file does not describe its model, or undefined when it does. */
export function staleness(port, model, current, fresh) {
  if (!current) return 'no cache'
  for (const [file, entry] of Object.entries(current.files ?? {})) {
    if (typeof entry?.content !== 'string' || entry.sha256 !== digest(entry.content)) return `${file}: damaged bytes`
  }
  const next = fresh.data
  const have = JSON.stringify(current, null, 1)
  return have === JSON.stringify(next, null, 1) ? undefined : `${port}: cache differs from the model's cited files`
}

export function run({
  modelsDir = DEFAULT_MODELS, outDir = DEFAULT_OUT, check = process.argv.includes('--check'),
  only = process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : undefined,
  sourceBound = process.argv.includes('--source-bound'),
  checkouts,
} = {}) {
  if (sourceBound && (check || !only)) throw new Error('gen-api-sources: --source-bound rewrites one port: pass --port and not --check')
  mkdirSync(outDir, { recursive: true })
  const totals = []
  const failures = []
  for (const name of readdirSync(modelsDir).sort()) {
    const match = /^([a-z0-9]+)\.json$/.exec(name)
    if (!match || (only && match[1] !== only)) continue
    const port = match[1]
    const model = JSON.parse(readFileSync(join(modelsDir, name), 'utf8'))
    const target = join(outDir, `${port}.json`)
    const previous = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : undefined
    const { data, unavailable, absent } = cachePort(port, model, previous, checkouts ? { checkouts: (repo) => checkouts(port, repo) } : undefined)
    const count = Object.keys(data.files).length
    if (sourceBound && unavailable.length) {
      throw new Error(`gen-api-sources: ${port}: ${unavailable.length} cited files have no checkout holding ${String(model.revision).slice(0, 12)}: ${unavailable.slice(0, 5).join(', ')}`)
    }
    if (unavailable.length) {
      console.log(`gen-api-sources: ${port}: ${unavailable.length} cited files have no checkout holding their revision and no verified cache; skipped`)
    }
    if (absent.length) console.log(`gen-api-sources: ${port}: ${absent.length} cited files are not text files at their revision; skipped`)
    if (check) {
      const why = staleness(port, model, previous, { data })
      if (why && !(count === 0 && !previous)) failures.push(`${target}: ${why}; run node scripts/gen-api-sources.mjs`)
    } else if (count > 0 || previous) {
      writeFileSync(target, `${JSON.stringify(data, null, 1)}\n`)
    }
    totals.push([port, count, Object.values(data.files).reduce((sum, entry) => sum + Buffer.byteLength(entry.content), 0)])
  }
  if (sourceBound && !totals.length) throw new Error(`gen-api-sources: no model for ${only} in ${modelsDir}`)
  if (failures.length) throw new Error(failures.join('\n'))
  for (const [port, count, bytes] of totals) console.log(`gen-api-sources: ${port}: ${count} files, ${bytes} bytes`)
  console.log(`gen-api-sources: ${check ? 'cache matches' : 'wrote'} ${totals.reduce((sum, [, count]) => sum + count, 0)} revision-bound source files`)
  return totals
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run() } catch (error) { console.error(error.message); process.exit(1) }
}
