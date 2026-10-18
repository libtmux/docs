import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import { SymbolIndex } from '@libtmux/api-model'
import { Window } from 'happy-dom'
import { describe, expect, it } from 'vitest'
import { API_MODELS } from '../src/lib/api-models'
import { rehypeApiLinks } from '../src/plugins/rehype-api-links'
import { tmuxCatalog } from '../src/lib/tmux-catalog'
import { linkTmuxDoc } from '../src/lib/tmux-links'

/**
 * Multi-word catalog names written in prose and code across the guides and the
 * API documentation, and where each one ends up. The candidates come from the
 * catalog's own names, independently of the linker, so a mention the linker
 * misses is counted as plain rather than disappearing. Run with
 * `--silent=false` to read the table and the most frequent plain names.
 */
const catalogs = ['3.2a', '3.7c'].map((version) => tmuxCatalog(version))
const kinds = new Map<string, string>()
for (const model of catalogs) for (const entry of model.entries) {
  for (const name of [entry.name, ...(entry.aliases ?? [])]) if (/[-_]/.test(name)) kinds.set(name, entry.kind)
}
const TOKEN = /(?<![\w./:$%@#-])[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+(?![\w/-]|\.[A-Za-z])/g

type Where = 'catalog' | 'elsewhere' | 'plain'
const tally = new Map<string, Record<Where, number>>()
const plainNames = new Map<string, number>()
const snippets = new Map<string, string>()
function count(name: string, where: Where, surface: string, context = '') {
  const kind = kinds.get(name)
  if (!kind) return
  for (const key of [`${surface} ${kind}`, `all ${kind}`]) {
    const row = tally.get(key) ?? { catalog: 0, elsewhere: 0, plain: 0 }
    row[where]++
    tally.set(key, row)
  }
  if (where === 'plain') {
    plainNames.set(`${surface} ${name}`, (plainNames.get(`${surface} ${name}`) ?? 0) + 1)
    if (!snippets.has(`${surface} ${name}`)) snippets.set(`${surface} ${name}`, context)
  }
}

const docsRoot = fileURLToPath(new URL('../src/content/docs/', import.meta.url))
const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? files(join(directory, entry.name)) : /\.mdx?$/.test(entry.name) ? [join(directory, entry.name)] : [])

describe('tmux catalog coverage', () => {
  it('links the names guides and topics mention', async () => {
    const renderer = await createMarkdownProcessor({ rehypePlugins: [rehypeApiLinks], syntaxHighlight: false })
    for (const file of files(docsRoot)) {
      const path = relative(docsRoot, file)
      if (path.startsWith('ja/')) continue
      const source = readFileSync(file, 'utf8').replace(/^---[\s\S]*?\n---\n/, '').replace(/^import .*$/gm, '').replace(/<[A-Z][A-Za-z]*[^>]*\/>/g, '')
      const port = /^ports\/([^/]+)\//.exec(path)?.[1]
      const html = (await renderer.render(source, { frontmatter: { port } })).code
      const win = new Window()
      win.document.body.innerHTML = html
      for (const node of win.document.body.querySelectorAll('*')) {
        if (node.closest('pre') || ['SCRIPT', 'STYLE'].includes(node.tagName)) continue
        for (const child of node.childNodes) {
          if (child.nodeType !== 3) continue
          for (const match of (child.textContent ?? '').matchAll(TOKEN)) {
            const href = node.closest('a')?.getAttribute('href')
            count(match[0], href?.includes('/catalog/') ? 'catalog' : href ? 'elsewhere' : 'plain', `guides ${node.closest('code') ? 'code' : 'prose'}`, `${path}: ${(child.textContent ?? '').slice(Math.max(0, match.index! - 50), match.index! + 60)}`)
          }
        }
      }
      await win.happyDOM.abort()
    }
  }, 600_000)

  it('links the names API documentation mentions', () => {
    for (const [port, model] of Object.entries(API_MODELS)) {
      const index = new SymbolIndex(model.symbols, (symbol) => `/en/${port}/latest/reference/${symbol.slug}/`, port)
      for (const symbol of model.symbols) {
        const blocks = [symbol.doc, ...symbol.signatures.map((signature) => signature.doc)]
        const texts: (string | undefined)[] = blocks.flatMap((doc) => doc ? [doc.summary, doc.body,
          ...(doc.examples ?? []).flatMap((example) => [example.intro, example.outro])] : [])
        for (const signature of symbol.signatures) texts.push(signature.returnsDoc, ...signature.params.map((param) => param.doc))
        for (const text of texts) {
          if (!text) continue
          for (const span of linkTmuxDoc(index.linkText(text, symbol))) {
            const label = span.kind === 'ref' ? span.label : 'text' in span ? span.text : ''
            const href = span.kind === 'link' ? span.href : span.kind === 'ref' && span.link ? span.link.href : undefined
            for (const match of label.matchAll(TOKEN)) count(match[0], href?.includes('/catalog/') ? 'catalog' : href ? 'elsewhere' : 'plain', `api ${span.kind === 'text' ? 'prose' : 'code'}`, `${symbol.id}: ${label.slice(Math.max(0, match.index! - 50), match.index! + 60)}`)
          }
        }
      }
    }
  }, 600_000)

  it('reports what resolved', () => {
    const rows = [...tally].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, row]) => `${key.padEnd(16)} mentions ${row.catalog + row.elsewhere + row.plain}, catalog ${row.catalog}, elsewhere ${row.elsewhere}, plain ${row.plain}`)
    console.info(`\nCatalog coverage\n${rows.join('\n')}`)
    console.info(`\nPlain mentions\n${[...plainNames].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([key, n]) => `${n}\t${key}\t${snippets.get(key)?.replace(/\s+/g, ' ')}`).join('\n')}`)
    // Names that are deliberate references link; identifier-like uses (keyword
    // arguments, parameter names, doctest output) stay plain by design.
    for (const kind of ['option', 'hook', 'format']) {
      const row = tally.get(`all ${kind}`)!
      expect((row.catalog + row.elsewhere) / (row.catalog + row.elsewhere + row.plain), kind).toBeGreaterThan(0.9)
    }
    expect(tally.get('all hook')!.plain, 'every hook mention links').toBe(0)
  })
})
