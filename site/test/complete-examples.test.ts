import { createMarkdownProcessor, parseFrontmatter } from '@astrojs/markdown-remark'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import receipt from './fixtures/capture-examples.json'
import attach from './fixtures/attach-examples.json'
import products from './fixtures/product-examples.json'
import queries from './fixtures/query-examples.json'
import { remarkPortCode, resolvePortCode } from '../src/plugins/remark-port-code.mjs'
import { rehypeCodeTabs } from '../src/plugins/rehype-code-tabs.mjs'
import { docsEntryAvailable, pagePortLinks } from '../src/lib/page-port-links'
import { docsPath, docsRedirects, docsRoutePath } from '../src/lib/docs-paths'

const readPage = (page: string) => readFileSync(new URL(`../src/content/docs/${page}.md`, import.meta.url), 'utf8')
const parsePage = (page: string) => parseFrontmatter(readPage(page), { frontmatter: 'remove' })
const bodyOf = (page: string) => parsePage(page).content
const fences = (markdown: string) => [...markdown.matchAll(/^```(\S+)([^\n]*)\n([\s\S]*?)^```/gm)]
  .map((match) => ({ language: match[1], title: /title="([^"]+)"/.exec(match[2])?.[1], code: match[3] }))
const sha256 = (code: string) => createHash('sha256').update(code).digest('hex')
const examples = [...receipt.examples, ...attach.examples, ...products.examples, ...queries.examples]

afterEach(() => vi.unstubAllEnvs())

describe('verified complete programs', () => {
  // The receipt records separate native runs. This gate protects their exact
  // bytes through the renderers; changing a hash alone is not a native test.
  it.each(examples)('keeps the executed $page program and project files intact', (example) => {
    const { content, frontmatter } = parsePage(example.page)
    const selected = resolvePortCode(content, example.port, frontmatter.port)
    const blocks = fences(selected)
    for (const file of example.files) {
      const matches = blocks.filter((block) => block.title === file.name)
      expect(matches, `${example.port}/${file.name}`).toHaveLength(1)
      expect(sha256(matches[0].code), `${example.port}/${file.name}`).toBe(file.sha256)
    }
    expect(selected).toContain(example.sourceRevision)
    expect(selected).not.toMatch(/^```[^\n]*(?:\bregion|\bfile)="|^>>> /m)
    const commands = [...selected.matchAll(/^```console\n([\s\S]*?)^```/gm)]
      .map((match) => match[1].replace(/^\$ /gm, '').trim())
    expect(commands).toEqual(example.shellRecipe)
    for (const block of blocks) {
      const comment = ['python', 'sh', 'ruby', 'toml', 'cmake', 'yaml', 'properties'].includes(block.language)
        ? /^\s*#/ : block.language === 'lua' ? /^\s*--/ : /^\s*(?:\/\/|\/\*|\* )/
      for (const line of block.code.split('\n').filter((line) => comment.test(line))) {
        expect(line.replaceAll('\t', '  ').length, `${example.port}: ${line}`).toBeLessThanOrEqual(100)
      }
    }
  })

  it.each(examples)('preserves $page in its root-mounted and native HTML/Markdown', async (example) => {
    const { content: body, frontmatter } = parsePage(example.page)
    for (const port of ['', example.port]) {
      vi.stubEnv('LIBTMUX_DOCS_PORT', port)
      const renderer = await createMarkdownProcessor({
        remarkPlugins: [remarkPortCode], rehypePlugins: [rehypeCodeTabs], syntaxHighlight: false,
      })
      const html = (await renderer.render(body, { frontmatter })).code
      const window = new Window()
      try {
        window.document.body.innerHTML = html
        const markdown = fences(resolvePortCode(body, port, frontmatter.port))
        for (const file of example.files) {
          const expected = fences(body).find((block) => block.title === file.name)!
          const rendered = [...window.document.querySelectorAll(`pre > code.language-${expected.language}`)]
            .map((code) => code.textContent)
          expect(rendered, `${example.port}/${file.name} HTML`).toContain(expected.code)
          expect(markdown.find((block) => block.title === file.name)?.code,
            `${example.port}/${file.name} Markdown`).toBe(expected.code)
        }
        expect(window.document.querySelectorAll('libtmux-code-tabs')).toHaveLength(0)
      } finally {
        await window.happyDOM.close()
      }
    }
  })

  it.each([receipt, attach])('keeps $page about tmux and routes each program to its port', async (receipt) => {
    const root = readPage(receipt.page)
    expect(root).toMatch(/^supportedPorts: \[\]$/m)
    const blocks = fences(bodyOf(receipt.page))
    expect(blocks.length).toBeGreaterThan(0)
    expect(blocks.every((block) => ['bash', 'sh', 'shell', 'console'].includes(block.language))).toBe(true)
    expect(sha256(blocks.find((block) => block.title === receipt.rootExample.file)!.code))
      .toBe(receipt.rootExample.sha256)
    expect(root).toContain(receipt.rootExample.shellRecipe)
    expect(root).not.toMatch(/import libtmux|use libtmux|using LibTmux|#include|package main/)
    const docs = [{ id: receipt.page, data: { supportedPorts: [] as string[] } }, ...receipt.examples.map((example) => {
      expect(readPage(example.page)).toContain(`port: ${example.port}\n`)
      expect(readPage(example.page)).toContain(`route: ${receipt.page}\n`)
      expect(root).toContain(`/${example.port}/latest/${receipt.page}/`)
      return { id: example.page, data: { port: example.port, route: receipt.page } }
    })]
    expect(new Set(docs.map((doc) => docsRoutePath(doc))).size).toBe(receipt.examples.length + 1)
    for (const example of receipt.examples) {
      const available = docs.filter((doc) => docsEntryAvailable(doc, example.port))
      expect(available.map((doc) => docsRoutePath(doc, example.port))).toEqual([receipt.page])
    }
    const links = pagePortLinks({ pagePath: receipt.page, version: 'latest', defaults: {}, docs })
    expect(links.filter((link) => link.links.length).map((link) => link.port).sort())
      .toEqual(receipt.examples.map((example) => example.port).sort())
  })

  it('keeps the root workspace runnable and redirects legacy port pages to their owned examples', () => {
    const example = products.rootWorkspace
    const { content, frontmatter } = parsePage(example.page)
    expect(frontmatter.supportedPorts).toEqual([])
    const blocks = fences(content)
    expect(blocks.every((block) => ['sh', 'text', 'console'].includes(block.language))).toBe(true)
    for (const file of example.files) {
      const matching = blocks.filter((block) => block.title === file.name)
      expect(matching).toHaveLength(1)
      expect(sha256(matching[0].code)).toBe(file.sha256)
    }
    expect(blocks.filter((block) => block.language === 'console')
      .map((block) => block.code.replace(/^\$ /gm, '').trim())).toEqual(example.shellRecipe)
    const docs = [{ id: example.page, data: frontmatter }, ...example.ports.map((port) => {
      const id = `ports/${port}/workspace/${port === 'py' ? '' : 'internals/'}examples`
      const { frontmatter: data } = parsePage(id)
      expect(data.port).toBe(port)
      expect(data.aliases).toContain(example.page)
      expect(content).toContain(`/${port}/latest/${docsPath({ id, data })}/`)
      return { id, data }
    })]
    const links = pagePortLinks({ pagePath: example.page, version: 'latest', defaults: {}, docs })
    expect(links.filter((link) => link.links.length).map((link) => link.port).sort())
      .toEqual([...example.ports].sort())
    for (const port of example.ports) {
      const available = docs.filter((doc) => docsEntryAvailable(doc, port))
      expect(available).toHaveLength(1)
      expect(docsRedirects(available, port)).toEqual([
        { path: example.page, target: docsPath(available[0]) },
      ])
      const reverse = pagePortLinks({ pagePath: docsPath(available[0]), portSlug: port, version: 'latest', defaults: {}, docs })
      expect(reverse.filter((link) => link.links.length).map((link) => link.port).sort())
        .toEqual([...example.ports].sort())
    }
  })
})
