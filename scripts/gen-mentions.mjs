#!/usr/bin/env node
/**
 * Which prose pages mention which symbols, computed before anything renders.
 *
 * A symbol page can then say where it is discussed, which is the reverse of
 * what `rehype-api-links` already does forward.
 *
 * Computed rather than recorded. The obvious design has the rehype plugin note
 * each mention as it resolves one, and it is wrong twice over: a render-time
 * recorder observes nothing on a cached build and reports that as "no
 * mentions", indistinguishable from prose that stopped referring to the API —
 * and with the assembly's fingerprint cache hitting on every unchanged run,
 * that would be almost always. It also cannot be tested without rendering
 * 1,872 pages and grepping the output.
 *
 * The resolver is pure, so none of that is necessary: the same answer comes
 * from the Markdown and the models, with no build in the loop.
 *
 * Usage: node scripts/gen-mentions.mjs [--check]
 */
import { existsSync, globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resolver, notASymbol, tableMentions } from '../packages/api-model/src/index.ts'

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

if (check) {
  if (!existsSync(out)) {
    console.error('gen-mentions: mentions.json missing — run without --check')
    process.exit(1)
  }
  const data = JSON.parse(readFileSync(out, 'utf8'))
  console.log(
    `gen-mentions: ${data.mentions.length} mentions, ${data.dangling.length} unresolved, generated ${data.generated}`,
  )
  process.exit(0)
}

const models = PORTS.map((port) => join(modelDir, `${port}.json`))
  .filter((f) => existsSync(f))
  .map((f) => JSON.parse(readFileSync(f, 'utf8')))
if (!models.length) {
  console.error('gen-mentions: no models — run scripts/gen-api-model.mjs first')
  process.exit(1)
}
const resolver = new Resolver(models)

/** `site/src/content/docs/topics/traversal.md` becomes `/topics/traversal/`. */
function pageOf(file) {
  const rel = relative(contentDir, file).replace(/\.mdx?$/, '')
  const path = rel.endsWith('/index') ? rel.slice(0, -'/index'.length) : rel
  return `/${path}/`
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

  for (const { port, text, line } of tableMentions(source, PORT_BY_LABEL)) {
    if (notASymbol(text)) continue
    const res = resolver.resolve(port, text)
    if (res.how === 'ambiguous' || res.how === 'no-symbol' || res.how === 'not-a-symbol') {
      dangling.push({ port, text, page, line, why: res.how })
      continue
    }
    // Federated and module hits point outside the reference, and a symbol page
    // is what carries a backlink, so only symbol hits produce one.
    if (res.how === 'federated' || res.how === 'module-index') continue

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

mkdirSync(dirname(out), { recursive: true })
writeFileSync(
  out,
  `${JSON.stringify({ generated: new Date().toISOString(), mentions, dangling }, null, 1)}\n`,
)

const pages = new Set(mentions.map((m) => m.page)).size
const symbols = new Set(mentions.map((m) => `${m.port}:${m.symbol}`)).size
console.log(
  `gen-mentions: ${mentions.length} mentions of ${symbols} symbols across ${pages} pages, ${dangling.length} unresolved`,
)
