import { readFileSync } from 'node:fs'
import { parseFrontmatter } from '@astrojs/markdown-remark'
import { describe, expect, it, vi } from 'vitest'
import data from '../src/data/product-copy.json'
import { documentationTitle, headingTitle } from '../src/lib/branding'
import { PORT_BY_SLUG } from '../src/lib/ports'
import { mcpIntro, mcpTitle, workspaceIntro, workspaceShortTitle, workspaceSubtitle, workspaceTitle, introText } from '../src/lib/product-copy'
import { mcpShowcase } from '../src/lib/mcp-showcase'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

const CONTENT = new URL('../src/content/', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, CONTENT), 'utf8')
const frontmatter = (path: string) => parseFrontmatter(read(path)).frontmatter as Record<string, unknown> & { ports?: Record<string, Record<string, string>> }
const api = (port: string) => JSON.parse(readFileSync(new URL(`../src/data/api/${port}.json`, import.meta.url), 'utf8')) as { sources: { product: string; revision: string }[] }

const NAMES: Record<string, string> = {
  py: 'Python', ts: 'TypeScript', rs: 'Rust', go: 'Go', java: 'Java', csharp: 'C#', cxx: 'C++', swift: 'Swift', ruby: 'Ruby', julia: 'Julia', powershell: 'PowerShell',
}
/** Ports whose workspace overview the shared source writes, and the ones with a page of their own. */
const SHARED_WORKSPACE = ['py', 'ts', 'rs', 'go', 'java', 'csharp', 'cxx', 'swift']
const OWN_WORKSPACE = ['ruby', 'julia', 'powershell']
const MCP_PORTS = ['py', 'ts', 'rs', 'go', 'java', 'csharp', 'cxx', 'swift', 'ruby', 'julia']
const CORE = '/en/rs/latest/reference/'

describe('the product page titles', () => {
  it('name the language in one form for every port, and keep the short form for the tab', () => {
    expect(workspaceTitle('rs')).toBe('tmux workspace manager,')
    expect(workspaceSubtitle('rs')).toBe('forged in Rust.')
    expect(workspaceShortTitle('rs')).toBe('Rust-based tmux workspace manager')
    expect(mcpTitle('rs')).toBe('tmux MCP, built in Rust')
    for (const [port, name] of Object.entries(NAMES)) {
      expect(PORT_BY_SLUG[port]!.name, port).toBe(name)
      expect(`${workspaceTitle(port)} ${workspaceSubtitle(port)}`).toBe(`tmux workspace manager, forged in ${name}.`)
      expect(workspaceShortTitle(port)).toBe(`${name}-based tmux workspace manager`)
      expect(mcpTitle(port)).toBe(`tmux MCP, built in ${name}`)
    }
  })

  it('are what every workspace overview carries, with the short form beside it', () => {
    const shared = frontmatter('_workspace-shared/workspace/index.md')
    for (const port of SHARED_WORKSPACE) {
      expect(shared.ports![port]!.title, port).toBe(workspaceTitle(port))
      expect(shared.ports![port]!.subtitle, port).toBe(workspaceSubtitle(port))
      expect(shared.ports![port]!.shortTitle, port).toBe(workspaceShortTitle(port))
    }
    for (const port of OWN_WORKSPACE) {
      const page = frontmatter(`docs/ports/${port}/workspace/index.md`)
      expect(page.title, port).toBe(workspaceTitle(port))
      expect(page.subtitle, port).toBe(workspaceSubtitle(port))
      expect(page.shortTitle, port).toBe(workspaceShortTitle(port))
    }
  })

  it('are what every MCP overview carries, and its tab says the same', () => {
    for (const port of MCP_PORTS) {
      const page = frontmatter(`docs/ports/${port}/mcp/index.md`)
      expect(page.title, port).toBe(mcpTitle(port))
      expect(page.shortTitle, port).toBeUndefined()
    }
  })

  it('leave no page with the old forms, and give a port with nothing published the new form with a verdict', () => {
    const files = [...SHARED_WORKSPACE.map(() => '_workspace-shared/workspace/index.md'), ...OWN_WORKSPACE.map((port) => `docs/ports/${port}/workspace/index.md`),
      ...MCP_PORTS.map((port) => `docs/ports/${port}/mcp/index.md`)]
    for (const file of new Set(files)) {
      expect(read(file), file).not.toMatch(/^\s*title: (?:(?:Python|TypeScript|Rust|Go|Java|C#|C\+\+|Swift|Ruby|Julia|PowerShell) workspace manager|tmux workspace manager for \S+|Workspace Manager|tmux MCP for \S+|MCP server)$/m)
    }
    for (const port of ['elixir', 'lua']) {
      const name = port === 'elixir' ? 'Elixir' : 'Lua'
      expect(frontmatter(`docs/ports/${port}/workspace/index.md`).title).toBe(`tmux workspace manager, forged in ${name}, is not published`)
      expect(frontmatter(`docs/ports/${port}/mcp/index.md`).title).toBe(`tmux MCP, built in ${name}, is not published`)
    }
  })

  it('reach the tab, the social tags and the lists through a short form, and the heading through the long one', () => {
    const config = readFileSync(new URL('../src/content.config.ts', import.meta.url), 'utf8')
    expect(config).toMatch(/shortTitle: z\.string\(\)\.optional\(\)/)
    const layout = readFileSync(new URL('../src/layouts/DocsLayout.astro', import.meta.url), 'utf8')
    expect(layout).toContain('title={documentTitle ?? title}')
    expect(layout).toMatch(/<h1[^>]*>\{title\}\{subtitle && /)
    // The subtitle is the heading's second line, so the heading, a heading list and search still read the whole sentence.
    expect(layout.match(/<span class="page-subtitle">\{' '\}\{subtitle\}<\/span>\}/g)).toHaveLength(2)
    expect(layout).not.toContain('<p class="page-subtitle')
    expect(config).toMatch(/subtitle: z\.string\(\)\.optional\(\)/)
    const page = readFileSync(new URL('../src/components/docs/DocPage.astro', import.meta.url), 'utf8')
    expect(page).toContain('documentTitle={entry.data.shortTitle}')
    expect(page).toContain('subtitle={entry.data.subtitle}')
    const llms = readFileSync(new URL('../src/lib/llms.ts', import.meta.url), 'utf8')
    expect(llms).toContain('data.shortTitle ?? data.title')
    expect(llms).toContain('title: agentTitle(entry.data),')
    // The manifest titles a page as its Markdown twin does (test/agent-titles.test.ts).
    expect(readFileSync(new URL('../src/pages/docs.json.ts', import.meta.url), 'utf8')).toContain('title: agentTitle(served.data),')
    expect(documentationTitle(workspaceShortTitle('rs'), 'libtmux')).toContain('Rust-based tmux workspace manager')
  })
})

describe('a heading as plain text', () => {
  it('joins the title and the subtitle, and leaves a page without one alone', () => {
    expect(headingTitle({ title: workspaceTitle('rs'), subtitle: workspaceSubtitle('rs') })).toBe('tmux workspace manager, forged in Rust.')
    expect(headingTitle({ title: 'Quickstart' })).toBe('Quickstart')
  })

  it('is what the backlinks, the contribute link and the port labels carry', () => {
    const mentions = readFileSync(new URL('../src/data/mentions.json', import.meta.url), 'utf8')
    expect(mentions).toContain('"title": "tmux workspace manager, forged in Julia."')
    expect(mentions).not.toMatch(/"title": "tmux workspace manager,(?! forged in \w+\.|[^"]*not published)/)
    expect(readFileSync(new URL('../src/components/docs/DocPage.astro', import.meta.url), 'utf8')).toContain('headingTitle(entry.data)')
    expect(readFileSync(new URL('../src/lib/page-port-links.ts', import.meta.url), 'utf8')).toContain('headingTitle({ title, subtitle })')
  })
})

describe('the workspace introduction', () => {
  const text = (port: string) => introText(workspaceIntro(port, CORE)!)

  it('says what the maintainer wrote, for a port that has every verb', () => {
    expect(text('rs')).toBe('Session manager for tmux. Load, freeze, and convert tmux sessions through YAML/JSON configuration files. Powered by libtmux for Rust.')
    expect(workspaceIntro('rs', CORE)!.at(-2)).toEqual({ text: 'libtmux for Rust', href: CORE })
  })

  it('names only the verbs the port has', () => {
    for (const port of ['py', 'ts', 'rs', 'go', 'java', 'csharp', 'cxx', 'swift']) expect(text(port), port).toContain('Load, freeze, and convert tmux sessions')
    expect(text('julia')).toContain('Load and freeze tmux sessions')
    expect(text('julia')).not.toContain('convert')
    // Ruby's tool loads and nothing more. PowerShell's module also converts, through its ConvertTo cmdlets, and has no freeze.
    expect(text('ruby')).toContain('Load tmux sessions through')
    expect(text('ruby')).not.toMatch(/freeze|convert/)
    expect(text('powershell')).toContain('Load and convert tmux sessions through')
    expect(text('powershell')).not.toContain('freeze')
  })

  it('names the formats the port reads, and says when one needs a build', () => {
    for (const port of Object.keys(data.workspace)) expect(text(port), port).toContain('through YAML/JSON configuration files.')
    expect(text('swift')).toContain('YAML needs a build with the YAMLWorkspaces trait.')
    expect(text('rs')).not.toContain('trait')
  })

  it('follows the data: a verb added to a port is named, and one taken away is not', async () => {
    vi.resetModules()
    vi.doMock('../src/data/product-copy.json', () => ({
      default: {
        workspace: { ruby: { ...data.workspace.ruby, verbs: ['load', 'freeze'] }, rs: { ...data.workspace.rs, verbs: ['load', 'convert'], formats: ['JSON'] } },
        mcp: {},
      },
    }))
    const changed = await import('../src/lib/product-copy')
    expect(changed.introText(changed.workspaceIntro('ruby', CORE)!)).toContain('Load and freeze tmux sessions')
    expect(changed.introText(changed.workspaceIntro('rs', CORE)!)).toContain('Load and convert tmux sessions through JSON configuration files.')
    expect(changed.introText(changed.workspaceIntro('rs', CORE)!)).not.toContain('freeze')
    // A port the data does not know has no introduction to write.
    expect(changed.workspaceIntro('go', CORE)).toBeUndefined()
    vi.doUnmock('../src/data/product-copy.json')
  })

  it('has a verb or a format only where the port\'s own files name it, which the data records', () => {
    const evidence: Record<string, RegExp> = { load: /load|Invoke-TmuxWorkspace/i, freeze: /freeze/i, convert: /convert/i }
    for (const [port, claims] of Object.entries(data.workspace)) {
      expect(claims.verbs, port).toContain('load')
      const named = claims.checks.flatMap((check) => check.find.map((found) => found.text)).join('\n')
      for (const verb of claims.verbs) expect(named, `${port} ${verb}`).toMatch(evidence[verb]!)
      for (const format of claims.formats) expect(named, `${port} reads ${format}`).toMatch(new RegExp(format, 'i'))
      // What a port lacks is shown by the absence of its name in the file that lists the commands, whether or not other checks exist.
      const absent = claims.checks.flatMap((check) => check.absent)
      for (const verb of ['freeze', 'convert'].filter((candidate) => !claims.verbs.includes(candidate))) {
        expect(absent, `${port} lacks ${verb}, so its absence is checked`).toContain(verb)
      }
    }
  })

  it('is read at the revision the API model records now, so a moved pin forces a new reading', () => {
    for (const [port, claims] of Object.entries(data.workspace)) {
      expect(claims.revision, port).toBe(api(port).sources.find((source) => source.product === 'workspace')!.revision)
    }
    for (const [port, claims] of Object.entries(data.mcp)) {
      expect(claims.revision, port).toBe(api(port).sources.find((source) => source.product === 'mcp')!.revision)
    }
  })

  it('is written only for the ports whose workspace tool is published', () => {
    expect(Object.keys(data.workspace).sort()).toEqual(Object.keys(NAMES).sort())
    for (const port of ['elixir', 'lua']) expect(workspaceIntro(port, CORE)).toBeUndefined()
  })
})

describe('the MCP introduction', () => {
  const text = (port: string, grouped: boolean) => introText(mcpIntro(port, CORE, { grouped })!)

  it('says what the maintainer wrote, for a server that groups and enforces', () => {
    expect(text('rs', true)).toBe(
      'tmux terminal control for AI agents, built on libtmux for Rust and rmcp. This server maps tmux\'s object hierarchy — sessions, windows, panes — into MCP tools grouped by the operation they request. The server enforces the selected groups at the MCP tool boundary.',
    )
    const parts = mcpIntro('rs', CORE, { grouped: true })!
    expect(parts.filter((part) => typeof part !== 'string')).toEqual([
      { text: 'libtmux for Rust', href: CORE }, { text: 'rmcp', href: 'https://github.com/modelcontextprotocol/rust-sdk' },
    ])
  })

  it('links each port\'s own SDK at the home its data names', () => {
    const expected: Record<string, [string, string]> = {
      py: ['FastMCP', 'https://gofastmcp.com/'],
      ts: ['MCP TypeScript SDK', 'https://github.com/modelcontextprotocol/typescript-sdk'],
      rs: ['rmcp', 'https://github.com/modelcontextprotocol/rust-sdk'],
      go: ['MCP Go SDK', 'https://github.com/modelcontextprotocol/go-sdk'],
      java: ['MCP Java SDK', 'https://github.com/modelcontextprotocol/java-sdk'],
      csharp: ['MCP C# SDK', 'https://github.com/modelcontextprotocol/csharp-sdk'],
      ruby: ['MCP Ruby SDK', 'https://github.com/modelcontextprotocol/ruby-sdk'],
      julia: ['ModelContextProtocol.jl', 'https://github.com/JuliaSMLM/ModelContextProtocol.jl'],
    }
    for (const [port, [name, href]] of Object.entries(expected)) {
      const links = mcpIntro(port, CORE, { grouped: true })!.filter((part): part is { text: string; href: string } => typeof part !== 'string')
      expect(links.map((link) => [link.text, link.href]), port).toEqual([[`libtmux for ${NAMES[port]}`, CORE], [name, href]])
      expect(data.mcp[port as keyof typeof data.mcp], port).toMatchObject({ sdk: { name, href } })
      expect(href.startsWith('https://'), port).toBe(true)
    }
  })

  it('says so when a server carries its own protocol layer rather than an SDK', () => {
    for (const port of ['cxx', 'swift']) {
      const parts = mcpIntro(port, CORE, { grouped: true })!
      expect(introText(parts), port).toContain(`built on libtmux for ${NAMES[port]} with its own implementation of the Model Context Protocol.`)
      expect(parts.filter((part) => typeof part !== 'string').map((link) => (link as { href: string }).href), port).toEqual([CORE, 'https://modelcontextprotocol.io/'])
      expect(introText(parts), port).not.toMatch(/SDK/)
    }
  })

  it('claims groups and their enforcement only for a server that has them', async () => {
    for (const port of MCP_PORTS) {
      const grouped = (await mcpShowcase(port, 'latest'))!.selectsToolsets
      expect(grouped, `${port} selects toolsets`).toBe(!['ruby', 'julia'].includes(port))
      const sentence = text(port, grouped)
      if (grouped) {
        expect(sentence, port).toContain('grouped by the operation they request')
        expect(sentence, port).toContain('The server enforces the selected groups at the MCP tool boundary.')
      } else {
        expect(sentence, port).not.toMatch(/group|enforce/)
        expect(sentence, port).toContain('into MCP tools. It offers only the tools selected when it starts.')
      }
    }
  })

  it('is written for every port with an MCP server, and has an SDK or a protocol layer and never both', () => {
    expect(Object.keys(data.mcp).sort()).toEqual([...MCP_PORTS].sort())
    for (const [port, claims] of Object.entries(data.mcp)) expect(Boolean('sdk' in claims) !== Boolean('protocol' in claims), port).toBe(true)
    for (const port of ['powershell', 'elixir', 'lua']) expect(mcpIntro(port, CORE, { grouped: true }), port).toBeUndefined()
  })
})

describe('the introduction on the page', () => {
  it('renders each link as an anchor inside one paragraph, ahead of the picker and the install steps', async () => {
    const template = await loadAstroTemplate('components/docs/ProductIntro.astro')
    const html = await renderAstroTemplate(template, { props: { parts: workspaceIntro('rs', CORE) } })
    expect(html).toMatch(/<p class="product-intro" data-product-intro>Session manager for tmux\./)
    expect(html).toContain(`<a href="${CORE}">libtmux for Rust</a>`)
    expect(html.match(/<p /g)).toHaveLength(1)
    const page = readFileSync(new URL('../src/components/docs/DocPage.astro', import.meta.url), 'utf8')
    expect(page.indexOf('<ProductIntro parts={productIntro} />')).toBeGreaterThan(0)
    expect(page.indexOf('<ProductIntro parts={productIntro} />')).toBeLessThan(page.indexOf('<WorkspacePicker showcase={workspaceExamples} />'))
    expect(page.indexOf('<ProductIntro parts={productIntro} />')).toBeLessThan(page.indexOf('<McpInstall port={port} />'))
    expect(page).toContain("mcpIntro(port, coreHome, { grouped: mcpTools?.selectsToolsets ?? false })")
  })
})
