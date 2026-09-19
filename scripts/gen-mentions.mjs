#!/usr/bin/env node
/** Build "Discussed in" backlinks from source, including when rendering is cached. */
import { existsSync, globSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resolver, decideMention, isLikelyReference, notASymbol, notApiReason, proseMentions } from '../packages/api-model/src/index.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const contentDir = join(root, 'site/src/content/docs')
const sharedDir = join(root, 'site/src/content/_workspace-shared')
const modelDir = join(root, 'site/src/data/api')
const out = join(root, 'site/src/data/mentions.json')
const check = process.argv.includes('--check')

const { PORTS: PORT_DEFS } = await import(`file://${resolve(root, 'site/src/lib/ports.ts')}`)
const PORTS = PORT_DEFS.map((p) => p.slug)
const { resolvePortBody } = await import(`file://${resolve(root, 'site/src/lib/workspace-shared-slots.ts')}`)

/** The first column's label, as the prose writes it. */
const PORT_BY_LABEL = {
  Python: 'py',
  TypeScript: 'ts',
  Rust: 'rs',
  Go: 'go',
  Java: 'java',
  '.NET': 'dotnet',
  'C#': 'dotnet',
  'C++': 'cxx',
  Swift: 'swift',
}

const modelList = PORTS.map((port) => join(modelDir, `${port}.json`))
  .filter((f) => existsSync(f))
  .map((f) => JSON.parse(readFileSync(f, 'utf8')))
if (!modelList.length) {
  console.error('gen-mentions: no models; run scripts/gen-api-model.mjs first')
  process.exit(1)
}
const models = Object.fromEntries(modelList.map((model) => [model.port, model]))
const resolver = new Resolver(modelList)
// Match the renderer's external names before considering a cross-port fallback.
for (const [file, project, baseUrl, langs] of [
  ['python', 'Python', 'https://docs.python.org/3/', ['py']],
  ['jdk', 'Java SE', 'https://docs.oracle.com/en/java/javase/21/docs/api/', ['java']],
  ['dom', 'MDN', 'https://developer.mozilla.org/', ['ts']],
]) {
  const inventory = JSON.parse(readFileSync(join(root, `site/src/data/inventories/${file}.entries.json`), 'utf8'))
  resolver.addInventory(project, baseUrl, inventory.e.map(([name, uri]) => ({
    name, uri, type: 'std:label', priority: 1, dispname: '-',
  })), langs)
}

/** `site/src/content/docs/topics/traversal.md` becomes `/topics/traversal/`. */
function pageOf(file) {
  const rel = relative(contentDir, file).replace(/\.mdx?$/, '')
  const path = rel.endsWith('/index') ? rel.slice(0, -'/index'.length) : rel
  return `/${path.replace(/^ports\/([^/]+)\//, '$1/latest/')}/`
}

/** The heading a page carries, so a backlink can be labelled. */
function titleOf(source, file) {
  const front = /^---\n([\s\S]*?)\n---/.exec(source)
  const title = front && /^title:\s*(.+)$/m.exec(front[1])
  if (title) return title[1].trim().replace(/^["']|["']$/g, '')
  const heading = /^#\s+(.+)$/m.exec(source)
  return heading ? heading[1].trim() : basename(file, '.md')
}

/**
 * `workspaceDocsLoader()` (site/src/loaders/workspace-shared.ts) synthesizes
 * 8 per-port `docs` collection entries from each file under
 * `_workspace-shared/`, at Astro build time. This script walks the
 * filesystem directly rather than the built collection (see the file
 * header), so it cannot see those synthetic entries — reconstruct them here
 * the same way, so a symbol mentioned in a shared workspace page still gets
 * a "Discussed in" backlink.
 *
 * SPIKE: the reconstructed frontmatter's line count does not match the
 * shared source's real frontmatter block, so a dangling-mention diagnostic's
 * `line` is offset from the file a contributor would open. The mention
 * itself, its `page`, and its resolved title are exact.
 */
function sharedWorkspaceEntries() {
  const entries = []
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.mdx?$/.test(name)) continue
      const relPath = relative(sharedDir, full).split('\\').join('/')
      const raw = readFileSync(full, 'utf8')
      const fm = /^---\r?\n([\s\S]*?\r?\n)---\r?\n?/.exec(raw)
      const body = fm ? raw.slice(fm[0].length) : raw
      const sharedTitle = (fm && /^title:\s*(.+)$/m.exec(fm[1])?.[1]) || basename(name, '.md')
      for (const port of PORTS) {
        // A port's own `ports.<slug>.title:` override, indented under the
        // shared frontmatter's `ports:` map exactly as authored (2, then 4,
        // spaces — see site/src/lib/workspace-shared-slots.ts's merge).
        const override = fm && new RegExp(`^  ${port}:\\n(?:.*\\n)*?    title:\\s*(.+)$`, 'm').exec(fm[1])?.[1]
        const title = override ?? sharedTitle
        entries.push({
          file: `ports/${port}/${relPath}`,
          source: `---\ntitle: ${title}\n---\n\n${resolvePortBody(body, port)}`,
        })
      }
    }
  }
  walk(sharedDir)
  return entries
}

const seen = new Set()
const mentions = []
const dangling = []

const realEntries = globSync('**/*.{md,mdx}', { cwd: contentDir })
  .sort()
  // Translations describe the same symbols as the page they translate, so a
  // backlink to both is one destination listed twice.
  .filter((file) => !file.startsWith('ja/'))
  .map((file) => ({ file, source: readFileSync(join(contentDir, file), 'utf8') }))

for (const { file, source } of [...realEntries, ...sharedWorkspaceEntries()]) {
  const full = join(contentDir, file)
  const page = pageOf(full)
  const title = titleOf(source, full)
  const section = file.split('/')[0]
  const authoredPort = /^ports\/([^/]+)\//.exec(file)?.[1]
  const product = /^ports\/[^/]+\/(workspace|mcp)\//.exec(file)?.[1]

  for (const { port: contextPort, text, line, before, linked } of proseMentions(source, PORT_BY_LABEL)) {
    const pagePort = contextPort ?? authoredPort
    if (notASymbol(text)) continue
    const decision = decideMention(text, { pagePort, product, before }, resolver, models)
    if (decision.kind !== 'link') {
      if (!linked && decision.kind === 'unresolved' && pagePort && isLikelyReference(text) && !notApiReason(text)) {
        dangling.push({ port: pagePort, text, page, line, why: decision.why })
      }
      continue
    }
    const port = decision.port
    const res = resolver.resolve(port, text, product)
    if (!('symbol' in res)) continue

    const symbol = res.symbol.id
    // `(port, symbol, page)` is the key: a symbol named three times on one
    // page is one backlink, not three.
    const key = `${port} ${symbol} ${page}`
    if (seen.has(key)) continue
    seen.add(key)
    mentions.push({ port, symbol, page, title, section })
  }
}

mentions.sort(
  (a, b) =>
    a.port.localeCompare(b.port) ||
    a.symbol.localeCompare(b.symbol) ||
    a.page.localeCompare(b.page),
)

if (check) {
  const existing = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : undefined
  if (JSON.stringify(existing?.mentions) !== JSON.stringify(mentions) || JSON.stringify(existing?.dangling) !== JSON.stringify(dangling)) {
    console.error('gen-mentions: index missing or stale; run node scripts/gen-mentions.mjs')
    process.exit(1)
  }
} else {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify({ generated: new Date().toISOString(), mentions, dangling }, null, 1)}\n`)
}

const pages = new Set(mentions.map((m) => m.page)).size
const symbols = new Set(mentions.map((m) => `${m.port}:${m.symbol}`)).size
console.log(
  `gen-mentions: ${mentions.length} mentions of ${symbols} symbols across ${pages} pages, ${dangling.length} unresolved`,
)
