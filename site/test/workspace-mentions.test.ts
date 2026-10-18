import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMarkdownProcessor, parseFrontmatter } from '@astrojs/markdown-remark'
import { select, selectAll, type Element } from 'astro-expressive-code/hast'
import { fromHtml } from 'hast-util-from-html'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { visit } from 'unist-util-visit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { collectWorkspaceEntities, formatWorkspaceEntities } from '../../scripts/lib/workspace-entities.mjs'
import entities from '../src/data/workspace-entities.json'
import tools from '../src/data/mcp-tools.json'
import { linkProseMarkdown } from '../src/lib/prose-markdown'
import { PORTS } from '../src/lib/ports'
import { KNOWN_PORTS, resolvePortBody, resolvePortData } from '../src/lib/workspace-shared-slots'
import { rehypeApiLinks } from '../src/plugins/rehype-api-links'
import { rehypeRowAnchors } from '../src/plugins/rehype-row-anchors'

beforeEach(() => vi.stubEnv('LIBTMUX_DOCS_PORT', ''))
afterEach(() => vi.unstubAllEnvs())

/*
 * Every workspace and MCP page of every port, rendered as the site renders it.
 *
 * The oracle is deliberately not the linker. It reads the generated index and
 * the MCP catalog and asks whether a code literal is spelled exactly like a
 * name they define, so a literal the linker declines, or a context it never
 * reaches, shows up here as a name that rendered plain.
 */
const docs = new URL('../src/content/docs/', import.meta.url).pathname
const shared = new URL('../src/content/_workspace-shared/', import.meta.url).pathname
const walk = (directory: string): string[] => existsSync(directory)
  ? readdirSync(directory).flatMap((name) => statSync(join(directory, name)).isDirectory() ? walk(join(directory, name)) : [join(directory, name)])
  : []

interface Page { port: string; route: string; product: 'workspace' | 'mcp'; file: string; body: string; frontmatter: Record<string, unknown> }

function pages(): Page[] {
  const found: Page[] = []
  for (const { slug } of PORTS) {
    for (const file of walk(join(docs, 'ports', slug))) {
      const route = relative(join(docs, 'ports', slug), file).replace(/\.mdx?$/, '').replace(/(?:^|\/)index$/, '')
      const product = /^(workspace|mcp)(?:\/|$)/.exec(route)?.[1] as Page['product'] | undefined
      if (!product || !/\.mdx?$/.test(file)) continue
      const { frontmatter, content } = parseFrontmatter(readFileSync(file, 'utf8'))
      found.push({ port: slug, route, product, file, body: content, frontmatter: { ...frontmatter, port: slug } })
    }
  }
  for (const file of walk(shared)) {
    const rel = relative(shared, file).replace(/\.mdx?$/, '')
    const { frontmatter, content } = parseFrontmatter(readFileSync(file, 'utf8'))
    for (const port of KNOWN_PORTS) {
      const body = resolvePortBody(content, port)
      if (!body.trim() || existsSync(join(docs, 'ports', port, `${rel}.md`))) continue
      found.push({ port, route: rel.replace(/(?:^|\/)index$/, ''), product: 'workspace', file, body, frontmatter: resolvePortData(frontmatter, port, 'workspace') })
    }
  }
  return found
}

type Kind = 'command' | 'option' | 'key' | 'tool' | 'resource'
interface Group { ports: string[]; program: string; commands: [string, string, boolean][]; options: [string, string, string][]; keys: [string, string, string][] }
const groupOf = (port: string) => (entities as { groups: Group[] }).groups.find((group) => group.ports.includes(port))
const protocolOf = (port: string) => (tools.ports as Record<string, {
  registrations: { wireName: string }[]
  protocol: { prompts: { name: string }[]; resources: { uri?: string }[]; resourceTemplates: { uriTemplate?: string }[] }
}>)[port]

const unquoted = (text: string) => /^"([A-Za-z_]\w*)"$/.exec(text)?.[1] ?? text
const textOf = (node: unknown): string => {
  const value = node as { type: string; value?: string; children?: unknown[] }
  return value.type === 'text' ? value.value ?? '' : (value.children ?? []).map(textOf).join('')
}
const isLibrary = (page: Page) => page.route.startsWith('workspace/internals') || page.route === 'workspace/reference'
  || (page.frontmatter.sidebar as { group?: string } | undefined)?.group === 'Internals'

interface Name { kind: Kind; name: string; whole: boolean }

/** What a code literal names on a page, by exact spelling and by the page it sits on. */
function named(page: Page, text: string): Name[] {
  const found: Name[] = []
  const group = groupOf(page.port)
  const protocol = protocolOf(page.port)
  if (group) {
    const rest = text.startsWith(`${group.program} `) ? text.slice(group.program.length + 1) : undefined
    if (rest !== undefined && group.commands.some(([name]) => rest === name || rest.startsWith(`${name} `))) found.push({ kind: 'command', name: text, whole: true })
  }
  if (group && page.product === 'workspace' && !isLibrary(page)) {
    const listed = group.commands.some(([name, , isListed]) => isListed && name === text)
    const key = group.keys.some(([name]) => name === unquoted(text))
    const section = page.route.startsWith('workspace/cli') ? 'command' : page.route.startsWith('workspace/configuration') ? 'key' : undefined
    // A name that is both follows its section; elsewhere a quoted one is a key.
    if (listed && key) found.push({ kind: section ?? (text.startsWith('"') ? 'key' : 'command'), name: text, whole: true })
    else if (listed) found.push({ kind: 'command', name: text, whole: true })
    else if (key) found.push({ kind: 'key', name: text, whole: true })
    else if (group.options.some(([name, path]) => name === text.split(/\s+/)[0] && path === page.route)) found.push({ kind: 'option', name: text, whole: true })
  }
  if (protocol && page.product === 'mcp') {
    const names = new Set([...protocol.registrations.map((tool) => tool.wireName), ...protocol.protocol.prompts.map((prompt) => prompt.name)])
    if (names.has(text)) found.push({ kind: 'tool', name: text, whole: true })
    // Tokens of a longer run: a flag value, a list, a quoted array item.
    else for (const token of text.split(/[\s,"'=]+/)) if (names.has(token)) found.push({ kind: 'tool', name: token, whole: false })
  }
  if (protocol && /^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(text) && (page.product === 'mcp' || page.product === 'workspace')
    && (protocol.protocol.resources.some((resource) => resource.uri === text) || protocol.protocol.resourceTemplates.some((template) => template.uriTemplate === text))) {
    found.push({ kind: 'resource', name: text, whole: true })
  }
  return found
}

interface Literal { page: Page; text: string; kind: Kind; linked: boolean }

/** The first cell of a row defines its entry; a command's own page does not link back to itself. */
function definedHere(page: Page, text: string, firstCell: boolean): boolean {
  const group = groupOf(page.port)
  if (!group) return false
  const command = text.startsWith(`${group.program} `) ? text.slice(group.program.length + 1) : text
  return group.commands.some(([name, path]) => (command === name || command.startsWith(`${name} `)) && path === page.route)
    || (firstCell && (group.keys.some(([name, path]) => name === unquoted(text) && path === page.route)
      || group.options.some(([name, path]) => name === text.split(/\s+/)[0] && path === page.route)))
}

/** Inline code naming something with a page of its own, and whether it rendered as, or around, a link. */
async function literals(processor: Awaited<ReturnType<typeof createMarkdownProcessor>>, all: Page[]): Promise<Literal[]> {
  const found: Literal[] = []
  for (const page of all) {
    const { code } = await processor.render(page.body, { frontmatter: page.frontmatter, fileURL: new URL(`file://${page.file}`) })
    const tree = fromHtml(code, { fragment: true })
    const wrapped = new Set<Element>()
    for (const anchor of selectAll('a', tree)) for (const code of selectAll('code', anchor)) wrapped.add(code)
    const exempt = new Set<Element>()
    for (const container of selectAll('pre, h1, h2, h3, h4, h5, h6', tree)) for (const code of selectAll('code', container)) exempt.add(code)
    const firstCells = new Set<Element>()
    for (const row of selectAll('tr', tree)) {
      const cell = row.children.find((child): child is Element => child.type === 'element' && child.tagName === 'td')
      if (cell) for (const code of selectAll('code', cell)) firstCells.add(code)
    }
    for (const code of selectAll('code', tree)) {
      const text = textOf(code).trim()
      if (exempt.has(code) || definedHere(page, text, firstCells.has(code))) continue
      const inner = selectAll('a', code).map(textOf)
      for (const { kind, name, whole } of named(page, text)) {
        // A name inside a longer invocation links on its own, within the code span.
        const linked = wrapped.has(code) || inner.some((label) => whole ? kind === 'command' && text.startsWith(label) : label === name)
        found.push({ page, text, kind, linked })
      }
    }
  }
  return found
}

const allPages = pages()
const renderer = (linking = true) => createMarkdownProcessor({ rehypePlugins: linking ? [rehypeApiLinks, rehypeRowAnchors] : [rehypeRowAnchors], syntaxHighlight: false })
const unlinked = (found: Literal[]) => found.filter((entry) => !entry.linked).map(({ page, text, kind }) => `${page.port} ${page.route}: ${kind} ${text}`)

describe('workspace and MCP pages', () => {
  it('link every code literal that names a command, option, key, tool or resource', async () => {
    const found = await literals(await renderer(), allPages)
    const tally: Record<string, Record<string, { named: number; linked: number }>> = {}
    for (const { page, kind, linked } of found) {
      const row = ((tally[page.port] ??= {})[kind] ??= { named: 0, linked: 0 })
      row.named++
      if (linked) row.linked++
    }
    if (process.env.WORKSPACE_MENTIONS_TALLY) writeFileSync(process.env.WORKSPACE_MENTIONS_TALLY, JSON.stringify({ tally, misses: unlinked(found) }, null, 1))
    expect(unlinked(found)).toEqual([])
    // A check that names nothing cannot fail: every kind is exercised on several ports.
    for (const kind of ['command', 'key', 'tool', 'resource'] as const) {
      expect(Object.values(tally).filter((port) => port[kind]?.named).length, kind).toBeGreaterThan(1)
    }
  }, 600000)

  it('are reported when nothing links them, and not when there is nothing to link', async () => {
    const topics = allPages.filter((page) => page.port === 'py' && page.route === 'workspace/topics')
    const misses = unlinked(await literals(await renderer(false), topics))
    // The names the maintainer found unlinked on /py/latest/workspace/topics/.
    expect(misses).toEqual(expect.arrayContaining([
      'py workspace/topics: command tmuxp load', 'py workspace/topics: command tmuxp freeze', 'py workspace/topics: key shell_command_before',
    ]))
    const plain = [{ ...topics[0], body: 'Nothing named here, only `plain_text` and `42`.' }]
    expect(await literals(await renderer(false), plain)).toEqual([])
  }, 120000)

  it('export the same destinations as Markdown', async () => {
    const processor = await renderer()
    for (const page of allPages) {
      const { code } = await processor.render(page.body, { frontmatter: page.frontmatter, fileURL: new URL(`file://${page.file}`) })
      const rendered = new Set(selectAll('a', fromHtml(code, { fragment: true })).filter((anchor) => select('code', anchor))
        .map((anchor) => String(anchor.properties.href)).filter((href) => /\/(?:workspace\/(?:cli|configuration)|mcp\/)/.test(href)))
      const markdown = linkProseMarkdown(page.body, page.port, page.product, {
        page: { id: `ports/${page.port}/${page.route}`, data: { port: page.port, product: page.product, sidebar: page.frontmatter.sidebar as { group?: string } | undefined } },
      })
      const exported = new Set<string>()
      visit(fromMarkdown(markdown), 'link', (node) => { exported.add(node.url) })
      expect([...rendered].filter((href) => !exported.has(href)), `${page.port} ${page.route}`).toEqual([])
      expect(markdown, `${page.port} ${page.route}`).not.toMatch(/api-link-kind|data-api-kind|workspace-mention/)
    }
  }, 600000)
})

describe('the workspace entity index', () => {
  it('records the anchor each table row receives on the rendered page', async () => {
    const processor = await renderer()
    for (const group of (entities as { groups: Group[] }).groups) {
      const port = group.ports[0]
      const rendered = new Map<string, Set<string>>()
      for (const page of allPages.filter((entry) => entry.port === port && entry.product === 'workspace')) {
        const { code } = await processor.render(page.body, { frontmatter: page.frontmatter, fileURL: new URL(`file://${page.file}`) })
        rendered.set(page.route, new Set(selectAll('tr[id]', fromHtml(code, { fragment: true })).map((row) => String(row.properties.id))))
      }
      for (const [name, path] of group.commands) expect(rendered.has(path), `${port} ${name} page ${path}`).toBe(true)
      for (const [name, path, anchor] of [...group.options, ...group.keys]) {
        expect(rendered.get(path)?.has(anchor), `${port} ${name} at ${path}#${anchor}`).toBe(true)
      }
    }
  }, 300000)

  describe('generation', () => {
    const script = fileURLToPath(new URL('../../scripts/gen-workspace-entities.mjs', import.meta.url))
    const check = (file: string) => {
      try {
        execFileSync(process.execPath, [script, '--check', '--file', file], { encoding: 'utf8', stdio: 'pipe' })
        return { status: 0, stderr: '' }
      } catch (error) {
        const failure = error as { status: number; stderr: string }
        return { status: failure.status, stderr: failure.stderr }
      }
    }

    it('fails when the committed index no longer matches the pages, and passes when it does', () => {
      const scratch = mkdtempSync(join(tmpdir(), 'workspace-entities-'))
      try {
        const committed = readFileSync(new URL('../src/data/workspace-entities.json', import.meta.url), 'utf8')
        const fresh = join(scratch, 'fresh.json')
        writeFileSync(fresh, committed)
        expect(check(fresh)).toEqual({ status: 0, stderr: '' })
        const stale = join(scratch, 'stale.json')
        writeFileSync(stale, committed.replace('"shell_command_before"', '"shell_command_after"'))
        const failure = check(stale)
        expect(failure.status).toBe(1)
        expect(failure.stderr).toContain('index missing or stale')
      } finally {
        rmSync(scratch, { recursive: true, force: true })
      }
    }, 120000)

    it('follows the headings and rows of the pages it reads', () => {
      const scratch = mkdtempSync(join(tmpdir(), 'workspace-sources-'))
      const write = (file: string, text: string) => {
        mkdirSync(join(file, '..'), { recursive: true })
        writeFileSync(file, text)
      }
      try {
        const shared = join(scratch, 'shared')
        write(join(shared, 'workspace/cli/index.md'), '---\ntitle: CLI\n---\n<!-- port:ts -->\n<dl><dt><a href="./run/"><code>run</code></a></dt></dl>\n<!-- /port -->\n')
        write(join(shared, 'workspace/cli/run.md'), '---\ntitle: Run\n---\n<!-- port:ts -->\n## Flags\n\n| Flag | Meaning |\n| --- | --- |\n| `--fast`, `-f` | Go quickly |\n| `--go` | First |\n| `--GO` | Same stem |\n<!-- /port -->\n')
        write(join(shared, 'workspace/cli/run-twice.md'), '---\ntitle: Twice\n---\n<!-- port:ts -->\nRepeat.\n<!-- /port -->\n')
        write(join(shared, 'workspace/configuration/session.md'), '---\ntitle: Session\nsidebar:\n  order: 2\n---\n<!-- port:ts -->\n## Session fields\n\n| Field | Effect |\n| --- | --- |\n| `name` | Names it |\n| `"quoted"` | Quoted form |\n| `not a key` | Prose |\n<!-- /port -->\n')
        write(join(shared, 'workspace/configuration/windows.md'), '---\ntitle: Windows\nsidebar:\n  order: 1\n---\n<!-- port:ts -->\n## Window keys\n\n| Key | Meaning |\n| --- | --- |\n| `name` | Window name |\n\n## Examples\n\n| Example | Notes |\n| --- | --- |\n| `ignored` | Not a key table |\n<!-- /port -->\n')
        const [group] = collectWorkspaceEntities({ docs: join(scratch, 'docs'), shared, ports: [{ slug: 'ts', program: 'tw' }, { slug: 'go', program: undefined }] })
        expect(group.ports).toEqual(['ts'])
        expect(group.commands).toEqual([
          { name: 'run', path: 'workspace/cli/run', listed: true },
          { name: 'run twice', path: 'workspace/cli/run-twice', listed: false },
        ])
        expect(group.options).toEqual([
          { name: '--fast', path: 'workspace/cli/run', anchor: 'flags-fast-f' },
          { name: '-f', path: 'workspace/cli/run', anchor: 'flags-fast-f' },
          { name: '--go', path: 'workspace/cli/run', anchor: 'flags-go' },
          { name: '--GO', path: 'workspace/cli/run', anchor: 'flags-go-2' },
        ])
        // The page with the lower sidebar order comes first, so a key shared by two pages leads to the first.
        expect(group.keys).toEqual([
          { name: 'name', path: 'workspace/configuration/windows', anchor: 'window-keys-name' },
          { name: 'name', path: 'workspace/configuration/session', anchor: 'session-fields-name' },
          { name: 'quoted', path: 'workspace/configuration/session', anchor: 'session-fields-quoted' },
        ])
        expect(formatWorkspaceEntities([group])).toContain('["run twice","workspace/cli/run-twice",false]')
      } finally {
        rmSync(scratch, { recursive: true, force: true })
      }
    })
  })
})
