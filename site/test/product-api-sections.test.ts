import { describe, expect, it } from 'vitest'
import { API_MODELS } from '../src/lib/api-models'
import { productApiNavigation, productApiRoots, productReferenceTree } from '../src/lib/product-api'
import { PRODUCT_SECTION_OVERRIDES, PRODUCT_SECTIONS, productApiSectionIds, productApiSections } from '../src/lib/product-api-sections'

const placed = (port: string, product: 'mcp' | 'workspace') => {
  const sections = productApiSections(API_MODELS[port], product)
  if (!sections) throw new Error(`${port} ${product} stays flat`)
  return Object.fromEntries(sections.flatMap(({ section, symbols }) => symbols.map((symbol) => [symbol.name, section.id])))
}
const products = ['mcp', 'workspace'] as const

describe('product API sections', () => {
  it('sorts the Rust MCP symbols into reader sections', () => {
    const rs = placed('rs', 'mcp')
    const expected: Record<string, string[]> = {
      tools: ['CaptureSinceArgs', 'ChannelArgs', 'TmuxTools'],
      resources: ['CAPABILITIES_URI', 'capabilities', 'CapabilityReport'],
      views: ['Branch', 'BranchPane', 'BranchWindow', 'Capture', 'Cursor', 'RunView', 'WaitOutcome', 'VariablesValue'],
      server: ['Builder', 'CallerIdentity', 'HELP', 'Options'],
      configuration: ['ENVIRONMENT_VALUES_ENV', 'EXCLUDE_TOOLS_ENV', 'environment_values_from_env', 'Toolset', 'Selection'],
      errors: ['SurfaceError', 'ToolError'],
    }
    for (const [section, names] of Object.entries(expected)) for (const name of names) expect(rs[name], name).toBe(section)
  })

  it('applies the same rules to Go, Python and C# MCP and to workspaces', () => {
    const go = placed('go', 'mcp')
    expect([go.AdvertisedTools, go.CapabilitiesResourceURI, go.ErrInstanceClosed, go.ToolsEnvironmentVariable, go.NewServer])
      .toEqual(['tools', 'resources', 'errors', 'configuration', 'server'])
    const py = placed('py', 'mcp')
    expect([py.capture_pane, py.run_and_wait, py.PaneInfo, py.AuditMiddleware, py.MAX_BATCH_OPERATIONS, py.ToolErrorResultMiddleware])
      .toEqual(['tools', 'prompts', 'views', 'server', 'configuration', 'server'])
    const cs = placed('csharp', 'mcp')
    expect([cs.PaneSnapshot, cs.ServerPolicy, cs.LibTmuxMcp]).toEqual(['views', 'configuration', 'server'])
    const pyWorkspace = placed('py', 'workspace')
    expect([pyWorkspace.command_load, pyWorkspace.WorkspaceBuilder, pyWorkspace.find_workspace_file, pyWorkspace.PaneNotFound, pyWorkspace.TmuxpPlugin])
      .toEqual(['cli', 'building', 'configuration', 'errors', 'integrations'])
    const ts = placed('ts', 'workspace')
    expect([ts.parseWorkspace, ts.planWorkspace, ts.WorkspaceApplyError]).toEqual(['configuration', 'building', 'errors'])
    const rs = placed('rs', 'workspace')
    expect([rs.Workspace, rs.freeze, rs.WorkspaceBuilder, rs.BuildError]).toEqual(['configuration', 'building', 'building', 'errors'])
  })

  it('places every public root exactly once, in A-Z order within a section, for every port', () => {
    let grouped = 0
    for (const model of Object.values(API_MODELS)) for (const product of products) {
      const roots = productApiRoots(model, product)
      const sections = productApiSections(model, product)
      if (!sections) continue
      grouped++
      const ids = sections.flatMap(({ symbols }) => symbols.map((symbol) => symbol.id))
      expect(ids.slice().sort(), `${model.port} ${product}`).toEqual(roots.map((symbol) => symbol.id).sort())
      expect(new Set(ids).size).toBe(ids.length)
      const vocabulary = PRODUCT_SECTIONS[product].map((section) => section.id)
      expect(sections.map(({ section }) => section.id)).toEqual(vocabulary.filter((id) => sections.some(({ section }) => section.id === id)))
      for (const { symbols } of sections) expect(symbols.map((symbol) => symbol.name)).toEqual(symbols.map((symbol) => symbol.name).sort((a, b) => a.localeCompare(b)))
    }
    expect(grouped).toBeGreaterThan(10)
  })

  it('is deterministic', () => {
    for (const model of Object.values(API_MODELS)) for (const product of products) {
      const once = [...productApiSectionIds(model, product)]
      expect([...productApiSectionIds(model, product)]).toEqual(once)
    }
  })

  it('keeps a product shorter than its headings flat', () => {
    expect(productApiSections(API_MODELS.ruby, 'mcp')).toBeUndefined()
    expect(productApiSections(API_MODELS.java, 'workspace')).toBeUndefined()
  })

  it('names only symbols that exist in every override', () => {
    for (const [key, names] of Object.entries(PRODUCT_SECTION_OVERRIDES)) {
      const [port, product] = key.split(':') as [string, 'mcp' | 'workspace']
      const roots = new Set(productApiRoots(API_MODELS[port], product).map((symbol) => symbol.name))
      for (const name of Object.keys(names)) expect(roots.has(name), `${key} ${name}`).toBe(true)
      for (const section of Object.values(names)) expect(PRODUCT_SECTIONS[product].map((entry) => entry.id)).toContain(section)
    }
  })

  it('reaches the sidebar tree and the documentation navigation with every URL kept', () => {
    const model = API_MODELS.rs
    const tree = productReferenceTree(model, 'mcp', 'v1.2.3')
    expect(tree.buckets.map((bucket) => `${bucket.label} ${bucket.count}`)).toEqual([
      'Tools 22', 'Resources and URIs 5', 'Views and results 36', 'Server and setup 6', 'Configuration and environment 12', 'Errors 2', 'Utilities 0',
    ].filter((label) => !label.endsWith(' 0')))
    expect(tree.buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(productApiRoots(model, 'mcp').length)
    const groups = productApiNavigation(model, 'mcp', 'v1.2.3')
    // A section links where the tree's section row does: the page of its first entry.
    expect(groups.every((item) => item.type === 'group' && item.href?.startsWith('/rs/v1.2.3/mcp/reference/'))).toBe(true)
    expect(groups.map((item) => item.label)).toEqual(tree.buckets.map((bucket) => bucket.label))
  })
})

describe('section destinations', () => {
  it('link a section in the navigation where its tree row lands, for every grouped product', () => {
    let checked = 0
    for (const model of Object.values(API_MODELS)) for (const product of products) {
      if (!productApiSections(model, product)) continue
      const tree = productReferenceTree(model, product, 'v1.2.3')
      const groups = productApiNavigation(model, product, 'v1.2.3')
      expect(groups.map((group) => group.label), `${model.port} ${product}`).toEqual(tree.buckets.map((bucket) => bucket.label))
      for (const [index, group] of groups.entries()) {
        const bucket = tree.buckets[index]
        const target = bucket.types[0]
        expect(group.href, `${model.port} ${product} ${group.label}`).toBe(tree.hrefs?.[bucket.types.find((entry) => entry.slug === bucket.slug)?.id ?? target.id])
        checked++
      }
    }
    expect(checked).toBeGreaterThan(30)
  })
})
