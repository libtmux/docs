import { createMarkdownProcessor, parseFrontmatter } from '@astrojs/markdown-remark'
import { existsSync, globSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolvePortBody, resolvePortContent } from '../src/lib/workspace-shared-slots'
import { remarkPortCode, resolvePortCode } from '../src/plugins/remark-port-code.mjs'
import { rehypeSiteRoot } from '../src/plugins/rehype-site-root.mjs'
import { rehypeApiLinks } from '../src/plugins/rehype-api-links'
import { proseMentions } from '@libtmux/api-model'
import { proseHref } from '../src/lib/docs-paths'
import { docsEntryAvailable } from '../src/lib/page-port-links'

const languageNames: Record<string, string[]> = {
  py: ['Python'], ts: ['TypeScript'], go: ['Go'], rs: ['Rust'], java: ['Java'],
  dotnet: ['.NET', 'C#'], cxx: ['C++'], swift: ['Swift'],
}
const contentRoot = fileURLToPath(new URL('../src/content/', import.meta.url))

afterEach(() => vi.unstubAllEnvs())

const source = `Common tmux behavior.

<!-- port:root -->
## Choose a language
<!-- /port -->

<!-- port:go -->
<!-- port:root -->
### Go
<!-- /port -->
Use a Go context and check the returned error.

\`\`\`go
pane.SendKeys(ctx, request)
\`\`\`
<!-- /port -->

<!-- port:py -->
### Python cleanup
Use the Python context manager.

\`\`\`python
pane.send_keys("hello")
\`\`\`
<!-- /port -->

## Completion
Sending input does not wait for the program to finish.
`

describe('port prose ownership', () => {
  it('retains root comparisons and selects complete port prose', () => {
    const go = resolvePortBody(source, 'go')
    expect(go).toContain('Use a Go context')
    expect(go).toContain('## Completion')
    expect(go).not.toMatch(/Python|send_keys|Choose a language|### Go|<!--/)
    const root = resolvePortBody(source, undefined)
    expect(root).toContain('### Go')
    expect(root).toContain('### Python cleanup')
    expect(root).not.toContain('<!--')
  })

  it('retains explicit ownership for root API links and guide backlinks', async () => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', '')
    const body = '## Calls\n\n<!-- port:go -->Use `Session.Panes`.\n<!-- /port -->\n<!-- port:py -->Use `Session.panes`.\n<!-- /port -->'
    const renderer = await createMarkdownProcessor({ remarkPlugins: [remarkPortCode], rehypePlugins: [rehypeApiLinks], syntaxHighlight: false })
    const rendered = await renderer.render(body)
    expect(rendered.code).toContain('href="/go/latest/reference/tmux-session-panes/"')
    expect(rendered.code).toContain('href="/py/latest/reference/libtmux-session-panes/"')
    const selected = resolvePortContent(body)
    expect(proseMentions(selected.body, {}, selected.portAt).map(({ port, text }) => ({ port, text }))).toEqual([
      { port: 'go', text: 'Session.Panes' },
      { port: 'py', text: 'Session.panes' },
    ])
  })

  it('recognizes every supported library without widening workspace ownership', () => {
    for (const port of ['ruby', 'lua', 'kotlin', 'scala', 'fsharp']) {
      expect(resolvePortBody(`<!-- port:${port} -->native<!-- /port -->`, port)).toBe('native')
    }
  })

  it('treats scope markers inside Markdown demonstrations as literal content', () => {
    const example = '````markdown\n<!-- port:invalid -->\n```go\nexample\n```\n````\n'
    expect(resolvePortBody(example, 'go')).toBe(example)
  })

  it('selects setup commands inside shared console fences', () => {
    const body = '```console\n<!-- port:go -->$ go test ./...\n<!-- /port --><!-- port:ts -->$ bun test\n<!-- /port -->```'
    expect(resolvePortBody(body, 'go')).toBe('```console\n$ go test ./...\n```')
  })

  it('keeps conditional rows in one Markdown table', async () => {
    const body = '| Port | Call |\n| --- | --- |\n<!-- port:go -->\n| Go | SendKeys |\n<!-- /port -->\n<!-- port:py -->\n| Python | send_keys |\n<!-- /port -->'
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'go')
    const renderer = await createMarkdownProcessor({ remarkPlugins: [remarkPortCode], syntaxHighlight: false })
    const rendered = await renderer.render(body)
    expect(rendered.code.match(/<table>/g)).toHaveLength(1)
    expect(rendered.code).toContain('<td>SendKeys</td>')
    expect(rendered.code).not.toContain('Python')
  })

  it('rejects misspelled, empty and unmatched ownership markers', () => {
    for (const body of ['<!-- port:golang -->bad<!-- /port -->', '<!-- port: -->bad<!-- /port -->', '<!-- port:go -->bad']) {
      expect(() => resolvePortBody(body, 'go')).toThrow()
    }
  })

  it('resolves every shared workspace source without leaving ownership directives', () => {
    for (const path of globSync(`${contentRoot}_workspace-shared/**/*.md`)) {
      for (const port of Object.keys(languageNames)) {
        expect(resolvePortBody(readFileSync(path, 'utf8'), port), `${port}: ${path}`).not.toMatch(/<!--\s*\/?port/)
      }
    }
  })

  it.each(['ts', 'rs', 'go', 'java', 'dotnet', 'cxx', 'swift'])('keeps native workspace commands on %s pages', (port) => {
    for (const name of ['index', 'convert', 'edit', 'freeze', 'ls', 'debug-info', 'search', 'load', 'import', 'import-teamocil', 'import-tmuxinator', 'completion', 'shell']) {
      const raw = readFileSync(`${contentRoot}_workspace-shared/workspace/cli/${name}.md`, 'utf8')
      const body = resolvePortBody(raw, port)
      expect(body, `${port}:${name}`).toMatch(/\$ (?:EDITOR=vi )?tmux-workspace /)
      expect(body, `${port}:${name}`).not.toMatch(/\$ tmuxp |tmuxp compatibility reference|proposed native|seven native ports/i)
      expect(body, `${port}:${name}`).toContain(`https://github.com/libtmux/libtmux-${port}/blob/`)
      expect(body, `${port}:${name}`).not.toContain('https://github.com/tmux-python/tmuxp/')
    }
  })

  it.each(['ts', 'rs', 'go', 'java', 'dotnet', 'cxx', 'swift'])('keeps every shared workspace guide about %s', (port) => {
    for (const path of globSync(`${contentRoot}_workspace-shared/workspace/**/*.md`)) {
      const body = resolvePortBody(readFileSync(path, 'utf8'), port)
      expect(body, path).not.toMatch(/\$ (?:uv tool install tmuxp|tmuxp )|Python alternative|tmuxp compatibility reference|proposed native|seven native ports|workspace-cli worktree/i)
      const { frontmatter } = parseFrontmatter(body)
      if (/\/(?:guides|examples)\/index\.md$/.test(path) && Array.isArray(frontmatter.cards)) {
        // Browse pages link to complete guides; the guides own the programs
        // and source attribution. Every card must still name a real page.
        expect(body, path).not.toContain('```')
        expect(frontmatter.cards.length, path).toBeGreaterThan(0)
        for (const card of frontmatter.cards) {
          if (card.ports && !card.ports.includes(port)) continue
          expect(card.href, path).toMatch(/^\.\.?\//)
          const target = resolve(dirname(path), card.href)
          const relative = target.slice(`${contentRoot}_workspace-shared/`.length)
          const override = `${contentRoot}docs/ports/${port}/${relative}`
          expect([target, override].some((page) => existsSync(`${page}.md`) || existsSync(`${page}/index.md`)), `${path}: ${card.href}`).toBe(true)
        }
      } else expect(body, path).toContain(`https://github.com/libtmux/libtmux-${port}/blob/`)
      expect(body, path).not.toContain('https://github.com/tmux-python/tmuxp/')
      const repositories = [...body.matchAll(/https:\/\/github\.com\/libtmux\/libtmux-([a-z]+)\//g)]
      expect(repositories.map((match) => match[1]).every((slug) => slug === port), path).toBe(true)
    }
  })

  it.each(Object.entries(languageNames))('keeps shared articles specific to %s', (port, ownNames) => {
    const paths = globSync(`${contentRoot}docs/{concepts,guides,topics,examples}/*.md`)
    expect(paths.length).toBeGreaterThan(1)
    for (const path of paths) {
      const { content: source, frontmatter } = parseFrontmatter(readFileSync(path, 'utf8'))
      if (!docsEntryAvailable({ id: path.slice(`${contentRoot}docs/`.length).replace(/\.md$/, ''), data: frontmatter }, port)) continue
      const prose = resolvePortCode(source, port).replace(/^ *```[\s\S]*?^ *```.*$/gm, '')
      const names = [...prose.matchAll(/\b(?:Python|TypeScript|Go|Rust|Java|Swift)\b|\.NET|C\+\+|C#/g)].map((match) => match[0])
      expect(names.filter((name) => !ownNames.includes(name)), path).toEqual([])
    }
  })

  it('removes foreign headings and prose before HTML and heading metadata are generated', async () => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'go')
    const renderer = await createMarkdownProcessor({ remarkPlugins: [remarkPortCode], syntaxHighlight: false })
    const rendered = await renderer.render(source)
    expect(rendered.code).toContain('Use a Go context')
    expect(rendered.code).not.toMatch(/Python|send_keys|Choose a language|### Go/)
    expect(rendered.metadata.headings.map((heading) => heading.text)).toEqual(['Completion'])
  })

  it('does not read a missing source example that belongs to another port', async () => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'go')
    const renderer = await createMarkdownProcessor({ remarkPlugins: [remarkPortCode], syntaxHighlight: false })
    const rendered = await renderer.render('```python file="missing/unselected.py"\n```\n\n```go\nselected()\n```')
    expect(rendered.code).toContain('selected()')
  })

  it('keeps nested fence delimiters intact in Markdown exports', () => {
    const body = '~~~python\nforeign()\n~~~\n\n````markdown\n```python\nliteral()\n```\n````'
    expect(resolvePortCode(body, 'go')).toBe('\n````markdown\n```python\nliteral()\n```\n````')
  })

  it('keeps article links in the selected version in HTML and Markdown', async () => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'go')
    vi.stubEnv('LIBTMUX_DOCS_VERSION', 'v0.1')
    vi.stubEnv('LIBTMUX_DOCS_ROOT', '/pr-42/en/')
    const body = '[Task](/guides/sending-keys/)\n\n`[literal](/guides/x/)`\n\n```go\n// [literal](/guides/x/)\n```'
    const renderer = await createMarkdownProcessor({ rehypePlugins: [rehypeSiteRoot], syntaxHighlight: false })
    expect((await renderer.render(body)).code).toContain('href="/pr-42/en/go/v0.1/guides/sending-keys/"')
    const markdown = resolvePortCode(body, 'go', undefined, (href: string) => proseHref(href, '/pr-42/en', 'go', 'v0.1'))
    expect(markdown).toContain('[Task](/pr-42/en/go/v0.1/guides/sending-keys/)')
    expect(markdown).toContain('`[literal](/guides/x/)`')
    expect(markdown).toContain('// [literal](/guides/x/)')
    expect(proseHref('/guides/sending-keys/', '/en')).toBe('/en/tmux/guides/sending-keys/')
    expect(proseHref('/py/latest/', '/en', 'go')).toBe('/en/py/latest/')
  })

  it.each(['pane-interaction', 'options-and-hooks'])('curates the %s article in HTML and machine-readable text', async (name) => {
    const raw = readFileSync(new URL(`../src/content/docs/topics/${name}.md`, import.meta.url), 'utf8')
    const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '')
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'go')
    const renderer = await createMarkdownProcessor({ remarkPlugins: [remarkPortCode], syntaxHighlight: false })
    const rendered = await renderer.render(body)
    const markdown = resolvePortCode(body, 'go')
    for (const output of [rendered.code, markdown]) {
      expect(output).not.toMatch(/Python|TypeScript|Rust|Java|\.NET|C\+\+|Swift|pane\.send_keys|pane\.show_options/)
      expect(output).toContain('ctx')
    }
    expect(rendered.metadata.headings.map((heading) => heading.text)).not.toContain('Go')
    vi.stubEnv('LIBTMUX_DOCS_PORT', '')
    const rootRenderer = await createMarkdownProcessor({ remarkPlugins: [remarkPortCode], syntaxHighlight: false })
    const root = await rootRenderer.render(body)
    expect(root.code).toContain('Python')
    expect(root.code).toContain('language-python')
    expect(root.code).toContain('language-go')
  })
})
