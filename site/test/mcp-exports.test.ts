import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { fromHtml } from 'hast-util-from-html'
import { markdownTwins, writeMcpExports } from '../src/integrations/markdown-twins'
import { markdownDocument } from '../src/lib/markdown-twins'
import { MCP_REFERENCE, mcpReferenceRoutes } from '../src/lib/mcp-reference'

vi.mock('hast-util-from-html', async (importOriginal) => {
  const actual = await importOriginal<typeof import('hast-util-from-html')>()
  return { ...actual, fromHtml: vi.fn(actual.fromHtml) }
})

afterEach(() => vi.unstubAllEnvs())

const schema = {
  type: 'object',
  properties: {
    nested: {
      type: 'array',
      items: { type: 'object', properties: { choice: { enum: ['pane', 'window'] } }, required: ['choice'] },
    },
  },
  required: ['nested'],
  additionalProperties: false,
}
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
const base = '/preview/en/go/v9-proof/'

function fixture(run: (out: string, routes: ReturnType<typeof mcpReferenceRoutes>) => void) {
  const out = mkdtempSync(join(tmpdir(), 'libtmux-mcp-exports-'))
  const write = (path: string, text: string) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  }
  const routes = mcpReferenceRoutes('go', {}, 'v9-proof')
  try {
    write(
      join(out, 'docs.json'),
      JSON.stringify({ pages: [{ title: 'Guide', url: `https://libtmux.org${base}guide/` }] }),
    )
    write(join(out, 'llms.txt'), '# Guides\n\n## Documentation\n\n- [Guide](guide/)\n')
    write(
      join(out, 'llms-full.txt'),
      `# Guides\n\n---\n\n${markdownDocument({ title: 'Guide', url: `https://libtmux.org${base}guide/`, body: 'Existing prose.' })}`,
    )
    for (const route of routes) {
      const source = MCP_REFERENCE.go.registrations.find((tool) => tool.wireName === route.toolName)?.source
      write(
        join(out, route.path, 'index.html'),
        `<html><head>
<link rel="canonical" href="https://libtmux.org/en/go/stable/${route.path}/">
<link rel="alternate" type="text/markdown" data-twin="rendered" href="${base}${route.path}.md">
<meta name="description" content="Resolved Go contract for ${route.toolName ?? 'catalog'}">
</head><body><main><h1>${route.toolName ?? 'Go MCP tools'}</h1>
<p>Resolved Go contract for ${route.toolName ?? 'catalog'}.</p>
<p><a href="../">All tools</a> <a href="../${route.toolName ?? 'tools'}.json">JSON</a>
${source ? `<a href="https://github.com/${source.repo}/blob/${source.revision}/${source.file}">Source</a>` : ''}</p>
<h2 id="arguments">Arguments</h2><p>The nested selection is required.</p>
<h2 id="schemas">Schemas</h2><details data-pagefind-ignore="all"><summary>Input schema</summary>
<pre data-language="json"><code>${escape(JSON.stringify(schema, null, 2))}</code></pre></details>
<button>Copy</button><nav>Other languages</nav></main></body></html>`,
      )
    }
    run(out, routes)
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

it.each(['en', 'ja'])('adds every selected-port MCP contract when the requested locale is %s', (locale) => {
  fixture((out, routes) => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'go')
    vi.stubEnv('LIBTMUX_DOCS_VERSION', 'v9-proof')
    vi.stubEnv('LIBTMUX_DOCS_LOCALE', locale)
    const hooks = markdownTwins().hooks
    ;(hooks['astro:config:done'] as (value: unknown) => void)({ config: { base: base.slice(0, -1) } })
    ;(hooks['astro:build:done'] as (value: unknown) => void)({ dir: new URL(`file://${out}/`), logger: { info() {} } })
    const manifest = JSON.parse(readFileSync(join(out, 'docs.json'), 'utf8'))
    const full = readFileSync(join(out, 'llms-full.txt'), 'utf8')
    const index = readFileSync(join(out, 'llms.txt'), 'utf8')
    expect(manifest.pages).toHaveLength(routes.length + 1)
    expect(full).toContain('Existing prose.')
    for (const { path, toolName } of routes) {
      const url = `https://libtmux.org${base}${path}/`
      const entry = manifest.pages.find((page: { url: string }) => page.url === url)
      expect(entry, path).toBeDefined()
      expect(entry.markdownUrl).toBe(`https://libtmux.org${base}${path}.md`)
      expect(entry.source.repo).toBe('libtmux/libtmux-go')
      expect(entry.source.revision).toBe(MCP_REFERENCE.go.revision)
      if (toolName)
        expect(entry.source).toEqual(MCP_REFERENCE.go.registrations.find((tool) => tool.wireName === toolName)!.source)
      expect(entry.headings).toEqual([
        { id: 'arguments', level: 2, text: 'Arguments' },
        { id: 'schemas', level: 2, text: 'Schemas' },
      ])
      const twin = readFileSync(join(out, `${path}.md`), 'utf8')
      expect(full).toContain(twin)
      expect(index).toContain(`](${url})`)
      expect(twin).toContain('Resolved Go contract')
      expect(twin).toContain(MCP_REFERENCE.go.revision)
      expect(twin).not.toContain('Other languages')
      expect(twin).not.toContain('](../)')
      const fence = /```json\n([\s\S]*?)\n```/.exec(twin)
      expect(fence, path).not.toBeNull()
      expect(JSON.parse(fence![1])).toEqual(schema)
    }
    expect(full).not.toContain('/py/')
    expect(full).not.toContain('/stable/')
  })
})

it('keeps repeated export generation byte-identical', () => {
  fixture((out, routes) => {
    const files = ['docs.json', 'llms.txt', 'llms-full.txt']
    writeMcpExports(out, base, routes)
    const before = files.map((file) => readFileSync(join(out, file), 'utf8'))
    writeMcpExports(out, base, routes)
    expect(files.map((file) => readFileSync(join(out, file), 'utf8'))).toEqual(before)
  })
})

it('parses each MCP twin once while preserving every final export byte', () => {
  let expected: string[] = []
  for (const legacyOrder of [true, false])
    fixture((out, routes) => {
      // A translated root runs only the generic pass, reproducing the old first pass.
      vi.stubEnv('LIBTMUX_DOCS_PORT', legacyOrder ? '' : 'go')
      vi.stubEnv('LIBTMUX_DOCS_LOCALE', legacyOrder ? 'ja' : 'en')
      vi.stubEnv('LIBTMUX_DOCS_VERSION', 'v9-proof')
      writeFileSync(
        join(out, 'ordinary.html'),
        `<html><head>
<link rel="canonical" href="https://libtmux.org${base}ordinary/">
<link rel="alternate" type="text/markdown" data-twin="rendered" href="${base}ordinary.md">
</head><body><main><h1>Ordinary page</h1><p>Keep this content.</p></main></body></html>`,
      )
      const hooks = markdownTwins().hooks
      ;(hooks['astro:config:done'] as (value: unknown) => void)({ config: { base } })
      vi.mocked(fromHtml).mockClear()
      ;(hooks['astro:build:done'] as (value: unknown) => void)({
        dir: new URL(`file://${out}/`),
        logger: { info() {} },
      })
      if (legacyOrder) writeMcpExports(out, base, routes)
      const files = [
        'docs.json',
        'llms.txt',
        'llms-full.txt',
        'ordinary.md',
        ...routes.map((route) => `${route.path}.md`),
      ]
      const actual = files.map((file) => readFileSync(join(out, file), 'utf8'))
      if (legacyOrder) {
        expected = actual
        expect(fromHtml).toHaveBeenCalledTimes(routes.length * 2 + 1)
      } else {
        expect(actual).toEqual(expected)
        expect(fromHtml).toHaveBeenCalledTimes(routes.length + 1)
      }
    })
})

it('still rejects a missing ordinary source twin after MCP exports are written', () => {
  fixture((out) => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'go')
    vi.stubEnv('LIBTMUX_DOCS_LOCALE', 'en')
    vi.stubEnv('LIBTMUX_DOCS_VERSION', 'v9-proof')
    writeFileSync(
      join(out, 'missing.html'),
      `<html><head>
<link rel="alternate" type="text/markdown" data-twin="source" href="${base}missing.md">
</head><body><main>Missing source twin</main></body></html>`,
    )
    const hooks = markdownTwins().hooks
    ;(hooks['astro:config:done'] as (value: unknown) => void)({ config: { base } })
    expect(() =>
      (hooks['astro:build:done'] as (value: unknown) => void)({
        dir: new URL(`file://${out}/`),
        logger: { info() {} },
      }),
    ).toThrow(/missing\.html.*missing\.md/)
  })
})

it.each(['lua', 'kotlin', 'scala', 'fsharp'])('adds no inherited MCP contracts for %s', (port) => {
  fixture((out) => {
    const before = readFileSync(join(out, 'docs.json'), 'utf8')
    writeMcpExports(out, base, mcpReferenceRoutes(port, {}, 'v9-proof'))
    expect(readFileSync(join(out, 'docs.json'), 'utf8')).toBe(before)
  })
})

it('reports a missing rendered MCP contract', () => {
  fixture((out, routes) => {
    rmSync(join(out, routes[1].path, 'index.html'))
    expect(() => writeMcpExports(out, base, routes)).toThrow(/ENOENT/)
  })
})

it('does not invent localized MCP routes in a shared translation build', () => {
  fixture((out) => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', '')
    vi.stubEnv('LIBTMUX_DOCS_LOCALE', 'ja')
    const before = readFileSync(join(out, 'docs.json'), 'utf8')
    const hooks = markdownTwins().hooks
    ;(hooks['astro:config:done'] as (value: unknown) => void)({ config: { base } })
    ;(hooks['astro:build:done'] as (value: unknown) => void)({ dir: new URL(`file://${out}/`), logger: { info() {} } })
    expect(readFileSync(join(out, 'docs.json'), 'utf8')).toBe(before)
  })
})
