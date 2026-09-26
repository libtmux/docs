#!/usr/bin/env node
/**
 * Every symbol and path named in prose is a link, or is named here as a
 * deliberate exception.
 *
 * The linker only ever visited table cells, reading the row's first column
 * for the port, so "Python's checked wait is `wait_for`" sat unlinked beside
 * a table whose every cell linked. Measured over the built site: 294 spans
 * linked, 1,257 did not, and 801 of those resolve to something.
 *
 * This reads Markdown, not HTML, so it needs no assembly and can run on one
 * file while it is being written. It shares `decideMention` with the linker,
 * which is the only reason its answer means anything: a lint that decides
 * separately from the thing it lints eventually disagrees with it, and the
 * disagreement is what a reader sees.
 *
 * Usage: node scripts/check-api-links.mjs [file...] [--json]
 */
import { existsSync, globSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resolver, decideFilePath, decideMention, isLikelyReference, looksLikeApiMention, notASymbol, notApiReason, proseMentions, readInventory } from '../packages/api-model/src/index.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { PORTS: PORT_DEFS } = await import(`file://${resolve(root, 'site/src/lib/ports.ts')}`)
const PORTS = PORT_DEFS.map((p) => p.slug)
const { KNOWN_PORTS, resolvePortBody } = await import(`file://${resolve(root, 'site/src/lib/workspace-shared-slots.ts')}`)
const SHARED = join(root, 'site/src/content/_workspace-shared')
const CONTENT = join(root, 'site/src/content/docs')
const started = Date.now()

const models = {}
for (const p of PORTS) {
  const f = join(root, 'site/src/data/api', `${p}.json`)
  if (existsSync(f)) models[p] = JSON.parse(readFileSync(f, 'utf8'))
}
if (!Object.keys(models).length) {
  console.error('check-api-links: no models — run scripts/gen-api-model.mjs first')
  process.exit(1)
}
const resolver = new Resolver(Object.values(models))

/*
 * The same federated inventories the linker loads, scoped the same way.
 *
 * Without them this lint reported `AutoCloseable`, `None` and `std::optional`
 * as resolving to nothing while the build linked them happily — a lint
 * disagreeing with the thing it lints, which is the failure this file's
 * shared `decideMention` exists to prevent, reappearing one level up.
 */
const INVENTORIES = [
  { file: 'python.inv', project: 'Python', baseUrl: 'https://docs.python.org/3/', langs: ['py'] },
  { file: 'jdk.inv', project: 'Java SE', baseUrl: 'https://docs.oracle.com/en/java/javase/21/docs/api/', langs: ['java'] },
  { file: 'dom.inv', project: 'MDN', baseUrl: 'https://developer.mozilla.org/', langs: ['ts'] },
]
for (const { file, project, baseUrl, langs } of INVENTORIES) {
  const inv = join(root, 'site/src/data/inventories', file)
  if (!existsSync(inv)) continue
  resolver.addInventory(project, baseUrl, readInventory(readFileSync(inv)).entries, langs)
}

/**
 * Every path each port ships at the revision its model records.
 *
 * Read from the sidecars `gen-api-model.mjs` writes, not from git: the lint
 * then needs no checkouts, runs on a fresh clone, and costs a file read
 * rather than eight subprocesses.
 */
const trees = {}
for (const port of PORTS) {
  const f = join(root, 'site/src/data/api', `${port}.paths.json`)
  if (!existsSync(f)) continue
  trees[port] = new Set(JSON.parse(readFileSync(f, 'utf8')).paths)
}

/**
 * Mentions that are deliberately not links, each with a reason.
 *
 * A numeric ceiling would let a new failure hide behind an old one. A list
 * makes every exception something a reviewer sees, and makes the 53rd
 * unresolved mention fail the moment it appears.
 */
const EXCEPTIONS = new Map()
{
  const f = join(root, 'site/src/data/prose-link-exceptions.json')
  if (existsSync(f)) {
    for (const [group, entry] of Object.entries(JSON.parse(readFileSync(f, 'utf8')))) {
      if (group.startsWith('$')) continue
      for (const span of entry.spans) EXCEPTIONS.set(span, entry.why)
    }
  }
}

const FILE_RE = /^[\w./@-]+\.(py|ts|tsx|js|rs|go|java|cs|cpp|hpp|h|swift|md|toml|json|ya?ml|sh)$/
const PORT_BY_LABEL = { Python: 'py', TypeScript: 'ts', Rust: 'rs', Go: 'go', Java: 'java', '.NET': 'dotnet', 'C#': 'dotnet', 'C++': 'cxx', Swift: 'swift' }

/**
 * `workspaceDocsLoader()` (site/src/loaders/workspace-shared.ts) synthesizes
 * 8 per-port `docs` collection entries from each file under
 * `_workspace-shared/` at Astro build time. This script reads Markdown
 * files directly rather than the built collection (see the file header), so
 * it cannot see those synthetic entries on its own — reconstruct them here
 * the same way `gen-mentions.mjs` does, so a shared workspace page's prose
 * is still checked for every port.
 */
function sharedWorkspaceRaw() {
  const raw = new Map()
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.mdx?$/.test(name)) continue
      const relPath = relative(SHARED, full).split('\\').join('/')
      const source = readFileSync(full, 'utf8')
      const fm = /^---\r?\n([\s\S]*?\r?\n)---\r?\n?/.exec(source)
      const body = fm ? source.slice(fm[0].length) : source
      // Ruby ships its own released workspace CLI and Lua has none, so
      // neither belongs to this generic, unreleased-CLI shared tree at all;
      // KNOWN_PORTS excludes both. A port whose own hand-authored page
      // already owns this path (matches
      // site/src/loaders/workspace-shared.ts's realIds exclusion) keeps
      // that page regardless.
      for (const port of PORTS.filter((slug) => KNOWN_PORTS.has(slug))) {
        const target = join(CONTENT, 'ports', port, relPath)
        if (existsSync(target)) continue
        raw.set(target, `---\nport: ${port}\nproduct: workspace\n---\n${resolvePortBody(body, port)}`)
      }
    }
  }
  walk(SHARED)
  return raw
}

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const sharedRaw = files.length ? new Map() : sharedWorkspaceRaw()
const targets = files.length
  ? files.map((f) => resolve(f))
  : [
      ...globSync('{topics,guides,concepts,examples,ports}/**/*.{md,mdx}', { cwd: CONTENT }).map((f) => join(CONTENT, f)),
      ...sharedRaw.keys(),
    ]

const tally = { willLink: 0, file: 0, fileMissing: 0, notASymbol: 0, unresolved: 0, alreadyLinked: 0 }
const unresolved = []
const missingFiles = []

for (const file of targets) {
  const raw = sharedRaw.get(file) ?? readFileSync(file, 'utf8')
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1] ?? ''
  const authoredPort = /^port:\s*['"]?([a-z]+)['"]?\s*$/m.exec(frontmatter)?.[1]
    ?? /^ports\/([^/]+)\//.exec(file.replace(`${CONTENT}/`, ''))?.[1]
  const product = /^product:\s*['"]?(core|workspace|mcp)['"]?\s*$/m.exec(frontmatter)?.[1]
    ?? /^ports\/[^/]+\/(workspace|mcp)\//.exec(file.replace(`${CONTENT}/`, ''))?.[1]
  for (const { text, port: ctxPort, before, line, linked } of proseMentions(raw, PORT_BY_LABEL)) {
    if (linked) { tally.alreadyLinked++; continue }
    const pagePort = ctxPort ?? authoredPort

    if (FILE_RE.test(text) || text.endsWith('/')) {
      const d = decideFilePath(text, { before, pagePort }, trees)
      if (d.kind === 'link') tally.file++
      else if (d.kind === 'skip') tally.notASymbol++
      else { tally.fileMissing++; missingFiles.push({ file, line, text, why: d.why }) }
      continue
    }
    // The same two filters the linker applies, in the same order. This lint
    // exists to agree with the build; applying one fewer of them made it
    // report 124 where the build reported 61, which is the disagreement it
    // was written to prevent.
    if (notASymbol(text) || !looksLikeApiMention(text)) { tally.notASymbol++; continue }


    const linkable = (authoredPort ? [pagePort] : [ctxPort, ...PORTS]).some((port) => {
      if (!port) return false
      const decision = decideMention(text, { pagePort: port, product, before }, resolver, models)
      return decision.kind === 'link'
    })
    // `notApiReason` gates *reporting*, not linking — exactly as the plugin
    // does. A span it names still gets offered to the resolver, because a
    // `TMUX_TMPDIR` that happens to resolve is a link worth having; it simply
    // is not a dangling reference when it does not.
    if (linkable) tally.willLink++
    else if (!isLikelyReference(text) || notApiReason(text) || EXCEPTIONS.has(text)) tally.notASymbol++
    else { tally.unresolved++; unresolved.push({ file, line, text }) }
  }
}

const rel = (f) => f.replace(`${CONTENT}/`, '')
const ms = Date.now() - started
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ pages: targets.map(rel), tally, unresolved, missingFiles, ms }, null, 1))
} else {
  console.log(`check-api-links: ${targets.length} pages in ${ms}ms`)
  console.log(`  already a link        ${String(tally.alreadyLinked).padStart(5)}`)
  console.log(`  links as a symbol     ${String(tally.willLink).padStart(5)}`)
  console.log(`  links as a file       ${String(tally.file).padStart(5)}`)
  console.log(`  left plain, not API   ${String(tally.notASymbol).padStart(5)}`)
  if (tally.fileMissing) {
    console.error(`\ncheck-api-links: ${tally.fileMissing} path(s) not present at the recorded revision:`)
    for (const u of missingFiles.slice(0, 25)) console.error(`  ${rel(u.file)}:${u.line}  ${u.text}  (${u.why})`)
  }
  if (tally.unresolved) {
    console.error(`\ncheck-api-links: ${tally.unresolved} mention(s) resolve to nothing:`)
    for (const u of unresolved.slice(0, 40)) console.error(`  ${rel(u.file)}:${u.line}  ${u.text}`)
  }
}
process.exit(tally.unresolved + tally.fileMissing ? 1 : 0)
