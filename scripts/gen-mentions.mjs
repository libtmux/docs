#!/usr/bin/env node
/** Build "Discussed in" backlinks from source, including when rendering is cached. */
import { existsSync, globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resolver, decideMention, isLikelyReference, notASymbol, notApiReason, proseMentions } from '../packages/api-model/src/index.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const contentDir = join(root, 'site/src/content/docs')
const modelDir = join(root, 'site/src/data/api')
const out = join(root, 'site/src/data/mentions.json')
const check = process.argv.includes('--check')

const { PORTS: PORT_DEFS } = await import(`file://${resolve(root, 'site/src/lib/ports.ts')}`)
const PORTS = PORT_DEFS.map((p) => p.slug)

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

const seen = new Set()
const mentions = []
const dangling = []

for (const file of globSync('**/*.{md,mdx}', { cwd: contentDir }).sort()) {
  // Translations describe the same symbols as the page they translate, so a
  // backlink to both is one destination listed twice.
  if (file.startsWith('ja/')) continue

  const full = join(contentDir, file)
  const source = readFileSync(full, 'utf8')
  const page = pageOf(full)
  const title = titleOf(source, full)
  const section = file.split('/')[0]
  const authoredPort = /^ports\/([^/]+)\//.exec(file)?.[1]

  for (const { port: contextPort, text, line, before } of proseMentions(source, PORT_BY_LABEL)) {
    const pagePort = contextPort ?? authoredPort
    if (notASymbol(text)) continue
    const decision = decideMention(text, { pagePort, before }, resolver, models)
    if (decision.kind !== 'link') {
      if (decision.kind === 'unresolved' && pagePort && isLikelyReference(text) && !notApiReason(text)) {
        dangling.push({ port: pagePort, text, page, line, why: decision.why })
      }
      continue
    }
    const port = decision.port
    const res = resolver.resolve(port, text)
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
