import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { bundledLanguages } from 'shiki'
import { describe, expect, it } from 'vitest'
import { checkoutFor } from '../src/plugins/remark-port-code.mjs'
import { unbalanced } from '../src/lib/example-blocks'
import { sliceExcerpt } from '../src/lib/example-excerpt'
import {
  LANDING_LABEL, MCP_SERVED_BY, isGap, landingCacheKey, landingExcerpt, landingOwner, landingPanels, landingProducts, landingRanges, workflowRuns,
  type CachedSource, type LandingExcerpt, type LandingProduct, type LandingTable,
} from '../src/lib/port-landing'
import { PORTS, PORT_BY_SLUG, productAvailable, type DocProduct } from '../src/lib/ports'
import LANDING from '../src/data/landing-examples.json'
import SOURCES from '../src/data/example-sources.json'

const table = LANDING as LandingTable
const cache = SOURCES as Record<string, CachedSource>
const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))

/** Every product a port ships, as the selector offers it. PowerShell serves MCP with the .NET tool. */
const PRODUCTS: Record<string, LandingProduct[]> = {
  py: ['core', 'mcp', 'workspace'],
  ruby: ['core', 'mcp', 'workspace'],
  lua: ['core'],
  powershell: ['core', 'mcp', 'workspace'],
  julia: ['core', 'mcp', 'workspace'],
  elixir: ['core'],
  ts: ['core', 'mcp', 'workspace'],
  rs: ['core', 'mcp', 'workspace'],
  go: ['core', 'mcp', 'workspace'],
  java: ['core', 'mcp', 'workspace'],
  csharp: ['core', 'mcp', 'workspace'],
  cxx: ['core', 'mcp', 'workspace'],
  swift: ['core', 'mcp', 'workspace'],
  kotlin: ['core'],
  scala: ['core'],
  fsharp: ['core'],
}

/**
 * The shipped products that have no program their port's CI runs. Naming them
 * here makes a new gap a reviewed change, and a closed gap a reminder to
 * remove the entry.
 */
const GAPS: readonly string[] = ['julia/mcp']

/**
 * The program each excerpt quotes. Moving a landing example to another program
 * is a reviewed change to this list, with the CI evidence that goes with it.
 */
const EXCERPT_FILES: Record<string, string> = {
  'py/mcp': 'tests/test_window_tools.py',
  'py/workspace': 'src/tmuxp/workspace/builder/classic.py',
  'ruby/mcp': 'examples/mcp_protocol.rb',
  'ruby/workspace': 'examples/workspace_apply.rb',
  'powershell/workspace': 'examples/Guides.ps1',
  'julia/workspace': 'packages/LibTmuxWorkspace/examples/owned_load.jl',
  'ts/mcp': 'examples/mcp-agent/mcp-agent.ts',
  'ts/workspace': 'examples/workspace/workspace.ts',
  'rs/mcp': 'crates/tmux-mcp/examples/readonly.rs',
  'rs/workspace': 'crates/tmux-workspace/examples/build.rs',
  'go/mcp': 'mcp/examples/agent-workflow/main.go',
  'go/workspace': 'workspace/examples/build-workspace/main.go',
  'java/mcp': 'examples/src/main/java/io/github/libtmux/examples/ServeTmuxOverMcp.java',
  'java/workspace': 'libtmux-workspace/src/test/java/io/github/libtmux/workspace/WorkspaceBuilderTest.java',
  'csharp/mcp': 'examples/LibTmux.Examples/Snippets/Mcp.cs',
  'csharp/workspace': 'src/LibTmux.Workspace.Cli/README.md',
  'cxx/mcp': 'apps/mcp/tests/mcp_test.cpp',
  'cxx/workspace': 'examples/workspace/tests/tmuxp_test.cpp',
  'swift/mcp': 'Examples/Sources/ExampleCode/MCPEmbedding.swift',
  'swift/workspace': 'Examples/Sources/ExampleCode/Workspaces.swift',
}

const products = (port: string): DocProduct[] => landingProducts(PORT_BY_SLUG[port]!).filter((product): product is DocProduct => product !== 'core')

describe('the products a port landing page offers', () => {
  it('lists every port, so a new port must say what it ships', () => {
    expect(Object.keys(PRODUCTS).sort()).toEqual(PORTS.map((port) => port.slug).sort())
  })

  it.each(Object.entries(PRODUCTS))('offers %j in selector order', (slug, expected) => {
    expect(landingProducts(PORT_BY_SLUG[slug]!)).toEqual(expected)
  })

  it('labels the selector Core API, MCP and Workspace Manager', () => {
    expect(landingProducts(PORT_BY_SLUG.go!).map((product) => LANDING_LABEL[product])).toEqual(['Core API', 'MCP', 'Workspace Manager'])
  })

  it('derives the set from what each port ships, apart from the .NET tool', () => {
    for (const port of PORTS) {
      expect(products(port.slug).includes('workspace'), `${port.slug} workspace`).toBe(productAvailable(port, 'workspace'))
      expect(products(port.slug).includes('mcp'), `${port.slug} mcp`).toBe(productAvailable(port, 'mcp') || port.slug in MCP_SERVED_BY)
    }
    expect(MCP_SERVED_BY).toEqual({ powershell: 'csharp' })
  })

  it('offers neither product for Lua, Elixir or a wrapper library', () => {
    for (const slug of ['lua', 'elixir', 'kotlin', 'scala', 'fsharp']) expect(products(slug), slug).toEqual([])
  })
})

describe('the excerpt of each shipped product', () => {
  const owned = PORTS.flatMap((port) => products(port.slug).map((product) => ({ port, product, owner: landingOwner(port, product) })))
  const excerpts = Object.entries(table).flatMap(([owner, entries]) =>
    Object.entries(entries).flatMap(([product, entry]) => (isGap(entry!) ? [] : [{ owner, product: product as DocProduct, entry: entry as LandingExcerpt }])))

  it('has an excerpt or a stated gap for every shipped product, and nothing else', () => {
    const wanted = new Set(owned.map(({ owner, product }) => `${owner}/${product}`))
    const recorded = Object.entries(table).flatMap(([owner, entries]) => Object.keys(entries).map((product) => `${owner}/${product}`))
    expect(recorded.filter((key) => !wanted.has(key)), 'entries for a product the port does not ship').toEqual([])
    expect([...wanted].filter((key) => !recorded.includes(key)), 'shipped products with no entry').toEqual([])
  })

  it('names the gaps in this test, so none is hidden', () => {
    const gaps = Object.entries(table).flatMap(([owner, entries]) =>
      Object.entries(entries).filter(([, entry]) => isGap(entry!)).map(([product]) => `${owner}/${product}`))
    expect(gaps.sort()).toEqual([...GAPS].sort())
    for (const entry of Object.values(table).flatMap((entries) => Object.values(entries))) {
      if (isGap(entry!)) expect(entry.missing.trim().length, 'a gap says what is missing').toBeGreaterThan(20)
    }
  })

  it('quotes these programs', () => {
    expect(Object.fromEntries(excerpts.map(({ owner, product, entry }) => [`${owner}/${product}`, entry.file]))).toEqual(EXCERPT_FILES)
  })

  it('reads PowerShell MCP from the .NET tool and keeps no entry of its own', () => {
    expect(table.powershell?.mcp).toBeUndefined()
    expect(landingOwner(PORT_BY_SLUG.powershell!, 'mcp')).toBe('csharp')
    expect(landingOwner(PORT_BY_SLUG.powershell!, 'workspace')).toBe('powershell')
    expect(landingExcerpt(PORT_BY_SLUG.powershell!, 'mcp', table, cache)).toEqual(landingExcerpt(PORT_BY_SLUG.csharp!, 'mcp', table, cache))
  })

  it.each(excerpts.map((item) => [`${item.owner} ${item.product}`, item] as const))('%s quotes the cached file at the revision its API model records', (_name, { owner, product, entry }) => {
    const model = read(`../src/data/api/${owner}.json`)
    const source = model.sources.find((candidate: { product: string }) => candidate.product === product)
    const cached = cache[landingCacheKey(owner, product, entry.file)]
    expect(cached, 'the example cache holds the file').toBeDefined()
    expect(cached).toMatchObject({ repository: source.repo, revision: source.revision })
    expect(createHash('sha256').update(cached!.content).digest('hex')).toBe((cached as CachedSource & { sha256: string }).sha256)
    const resolved = landingExcerpt(PORT_BY_SLUG[owner]!, product, table, cache)!
    expect(resolved.sourceUrl).toBe(`https://github.com/${source.repo}/blob/${source.revision}/${entry.file}`)
    expect(resolved.code.split('\n').length, 'a step, not a line').toBeGreaterThanOrEqual(4)
    // Each range starts at the line `from` names and ends at the line `to` names, and the ranges keep the file's order.
    const lines = cached!.content.split('\n')
    let after = -1
    for (const range of landingRanges(entry)) {
      const text = sliceExcerpt(cached!.content, range, entry.file)
      expect(unbalanced(text, entry.lang), `${range.from}: the range is a whole unit`).toBeUndefined()
      const shown = text.split('\n')
      const names = (line: string, anchor: string) => (anchor.startsWith('=') ? line.trim() === anchor.slice(1).trim() : line.includes(anchor))
      expect(names(shown[0]!, range.from), `starts at ${range.from}`).toBe(true)
      if (range.to) expect(names(shown.at(-1)!, range.to), `ends at ${range.to}`).toBe(true)
      const first = lines.findIndex((line, index) => index > after && names(line, range.from))
      expect(first, `${range.from} follows the previous range`).toBeGreaterThan(after)
      after = first + shown.length - 1
    }
    expect(resolved.code).toBe(landingRanges(entry).map((range) => sliceExcerpt(cached!.content, range, entry.file)).join('\n\n'))
  })

  it.each(excerpts.map((item) => [`${item.owner} ${item.product}`, item] as const))('%s names a language the highlighter has', (_name, { entry }) => {
    expect(Object.keys(bundledLanguages), entry.lang).toContain(entry.lang)
  })

  it.each(excerpts.map((item) => [`${item.owner} ${item.product}`, item] as const))('%s is short enough to read as a step', (_name, { owner, product, entry }) => {
    const { code } = landingExcerpt(PORT_BY_SLUG[owner]!, product, table, cache)!
    expect(code.split('\n').length, entry.file).toBeLessThanOrEqual(45)
  })

  it.each(excerpts.map((item) => [`${item.owner} ${item.product}`, item] as const))('%s names the CI step that runs it', (_name, { entry }) => {
    expect(entry.ci.workflow).toMatch(/^\.github\/workflows\/[\w.-]+\.ya?ml$/)
    expect(entry.ci.command.trim()).not.toBe('')
  })

  // A checkout that is not present cannot be asked; that is a machine fact, not a docs defect, and the run says it skipped.
  const checkoutOf = (owner: string, product: DocProduct) =>
    [checkoutFor(owner, product), PORT_BY_SLUG[owner]!.checkout.replace(/^~/, process.env.HOME ?? '')].find((path) => existsSync(`${path}/.git`))
  for (const { owner, product, entry } of excerpts) {
    it.skipIf(!checkoutOf(owner, product))(`${owner} ${product} runs in the workflow at that revision`, () => {
      const source = read(`../src/data/api/${owner}.json`).sources.find((candidate: { product: string }) => candidate.product === product)
      const workflow = execFileSync('git', ['-C', checkoutOf(owner, product)!, 'show', `${source.revision}:${entry.ci.workflow}`], { encoding: 'utf8', maxBuffer: 1 << 24 })
      expect(workflowRuns(workflow, entry.ci.command), `${entry.ci.workflow} at ${source.revision} runs ${entry.ci.command}`).toBe(true)
    })
  }
})

describe('the workflow command an excerpt records', () => {
  const workflow = (body: string) => `name: tests\njobs:\n  test:\n    steps:\n${body}`
  const wrapped = workflow(`      - name: Test
        run: |
          go vet ./...
          go test -race \\
            -count=1 ./...
      - name: Lint
        run: >-
          golangci-lint
          run ./...
      - run: just check
`)

  it('finds a command in a block, a folded scalar and an inline step, however the lines wrap', () => {
    expect(workflowRuns(wrapped, 'go test -race -count=1')).toBe(true)
    expect(workflowRuns(wrapped, 'golangci-lint run ./...')).toBe(true)
    expect(workflowRuns(wrapped, 'just check')).toBe(true)
  })

  it('refuses a command the workflow does not run', () => {
    expect(workflowRuns(wrapped, 'go test -race -count=2')).toBe(false)
    expect(workflowRuns(wrapped, 'go test -count=1')).toBe(false)
    expect(workflowRuns(wrapped, 'just test')).toBe(false)
  })

  it.each([
    ['a workflow comment', '# go test -race -count=1\n      - run: echo none\n'],
    ['a shell comment inside a step', '      - run: |\n          # go test -race -count=1\n          echo none\n'],
    ['a step name', '      - name: go test -race -count=1\n        run: echo none\n'],
    ['an environment value', '      - env:\n          COMMAND: go test -race -count=1\n        run: echo none\n'],
    ['the step after the one that runs it', '      - run: echo none\n      - name: go test -race -count=1\n        uses: actions/checkout@v4\n'],
  ])('does not count %s that spells the command', (_name, body) => {
    expect(workflowRuns(workflow(body), 'go test -race -count=1')).toBe(false)
    expect(workflowRuns(workflow(body.replace('go test -race -count=1', 'echo none')), 'echo none')).toBe(true)
  })

  it('reads every recorded command from a run step, so a planted one fails', () => {
    for (const { entry } of Object.entries(table).flatMap(([owner, entries]) =>
      Object.values(entries).flatMap((candidate) => (isGap(candidate!) ? [] : [{ owner, entry: candidate as LandingExcerpt }])))) {
      expect(workflowRuns(workflow(`      - run: ${entry.ci.command}\n`), entry.ci.command), entry.ci.command).toBe(true)
      expect(workflowRuns(workflow(`      - run: ${entry.ci.command} --planted\n`), `${entry.ci.command} --elsewhere`), entry.ci.command).toBe(false)
      expect(workflowRuns(workflow(`      - name: ${entry.ci.command}\n        run: echo none\n`), entry.ci.command), entry.ci.command).toBe(false)
    }
  })
})

describe('panels of the landing page', () => {
  const panels = (slug: string) => landingPanels(PORT_BY_SLUG[slug]!, 'latest', PORT_BY_SLUG, table, cache)

  it('has one panel per product, in selector order', () => {
    for (const [slug, expected] of Object.entries(PRODUCTS)) expect(panels(slug).map((panel) => panel.product), slug).toEqual(expected)
  })

  it('links each product to its own documentation', () => {
    expect(panels('go').map((panel) => panel.href)).toEqual([undefined, '/go/latest/mcp/', '/go/latest/workspace/'])
  })

  it('sends PowerShell MCP readers to the guide for the .NET tool and installs that tool', () => {
    const mcp = panels('powershell').find((panel) => panel.product === 'mcp')!
    expect(mcp.href).toBe('/powershell/latest/guides/mcp/')
    expect(mcp.install).toEqual({ widget: 'mcp', port: 'csharp' })
    expect(mcp.packageName).toBe('LibTmux.Mcp')
    expect(mcp.servedBy).toBe('C#')
    expect(panels('csharp').find((panel) => panel.product === 'mcp')!.servedBy, 'a port with its own server').toBeUndefined()
    expect(panels('powershell').find((panel) => panel.product === 'workspace')!.install).toEqual({ widget: 'package', port: 'powershell' })
  })

  it('names the package each panel installs', () => {
    expect(panels('go').map((panel) => panel.packageName)).toEqual(['github.com/libtmux/libtmux-go/tmux', 'github.com/libtmux/libtmux-go/mcp', 'github.com/libtmux/libtmux-go/workspace'])
    expect(panels('py').map((panel) => panel.packageName)).toEqual(['libtmux', 'libtmux-mcp', 'tmuxp'])
  })

  it('keeps an install widget for each product the port ships', () => {
    for (const slug of Object.keys(PRODUCTS)) {
      for (const panel of panels(slug)) expect(panel.install, `${slug} ${panel.product}`).toBeDefined()
    }
  })
})
