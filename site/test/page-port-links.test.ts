import { describe, expect, it, vi } from 'vitest'

vi.stubEnv('LIBTMUX_DOCS_PORT_ROOT', '/pr-42/en')
vi.stubEnv('LIBTMUX_DOCS_LOCALES_ROOT', '/pr-42')
const { pagePortLinks } = await import('../src/lib/page-port-links')
const { localePageHref, localeSourcePath } = await import('../src/i18n/locales')

const docs = [
  { id: 'concepts/model', data: {} },
  { id: 'guides/python-only', data: { port: 'py' } },
  { id: 'ports/ts/workspace/internals/guides', data: { port: 'ts', product: 'workspace' } },
  { id: 'ports/rs/workspace/internals/guides', data: { port: 'rs', product: 'workspace' } },
]
const options = { version: 'v1.2.3', defaults: { py: 'stable', ts: 'latest' }, docs }

describe('matching pages in another port', () => {
  it('switches product guides only where the matching page is authored', () => {
    const links = pagePortLinks({ ...options, pagePath: 'workspace/internals/guides', portSlug: 'ts' })
    expect(links.find((p) => p.port === 'ts')?.links[0].href).toBe('/pr-42/en/ts/v1.2.3/workspace/internals/guides/')
    expect(links.find((p) => p.port === 'rs')?.links[0].href).toBe('/pr-42/en/rs/latest/workspace/internals/guides/')
    expect(links.find((p) => p.port === 'py')?.links).toEqual([])
  })
  it('preserves the prose page and chooses the target port default', () => {
    const links = pagePortLinks({ ...options, pagePath: 'concepts/model', portSlug: 'py' })
    expect(links.find((p) => p.port === 'py')?.links[0].href).toBe('/pr-42/en/py/v1.2.3/concepts/model/')
    expect(links.find((p) => p.port === 'ts')?.links[0].href).toBe('/pr-42/en/ts/latest/concepts/model/')
  })

  it('disables pages excluded by their port and unknown root-only routes', () => {
    expect(pagePortLinks({ ...options, pagePath: 'guides/python-only' }).filter((p) => p.links.length).map((p) => p.port)).toEqual(['py'])
    expect(pagePortLinks({ ...options, pagePath: 'missing-page' }).every((p) => !p.links.length)).toBe(true)
  })

  it('keeps a shared nested route when switching ports', () => {
    const links = pagePortLinks({ ...options, pagePath: 'mcp/tools', portSlug: 'py' })
    expect(links.find((entry) => entry.port === 'ts')?.links[0].href).toBe('/pr-42/en/ts/latest/mcp/tools/')
  })

  it('switches MCP tools using each port’s registered wire name', () => {
    const links = pagePortLinks({ ...options, pagePath: 'mcp/tools/capture_pane', portSlug: 'ts' })
    expect(links.find((entry) => entry.port === 'lua')?.links).toEqual([])
    expect(links.filter((entry) => entry.port !== 'lua' && entry.port !== 'ruby').every((entry) => entry.links.length === 1)).toBe(true)
    expect(links.find((entry) => entry.port === 'ts')?.links[0].href).toBe('/pr-42/en/ts/v1.2.3/mcp/tools/capture_pane/')
    expect(links.find((entry) => entry.port === 'py')?.links[0].href).toBe('/pr-42/en/py/stable/mcp/tools/capture_pane/')
    expect(links.find((entry) => entry.port === 'dotnet')?.links[0].href).toBe('/pr-42/en/dotnet/latest/mcp/tools/capture_pane/')
    const reverse = pagePortLinks({ ...options, pagePath: 'mcp/tools/capture_pane', portSlug: 'dotnet' })
    expect(reverse.find((entry) => entry.port === 'ts')?.links[0].href).toBe('/pr-42/en/ts/latest/mcp/tools/capture_pane/')
  })

  it('links the current snapshot tool across ports and rejects unknown tools', () => {
    const links = pagePortLinks({ ...options, pagePath: 'mcp/tools/snapshot_pane', portSlug: 'ts' })
    expect(links.find((entry) => entry.port === 'py')?.links[0]?.href).toBe('/pr-42/en/py/stable/mcp/tools/snapshot_pane/')
    expect(links.find((entry) => entry.port === 'cxx')?.links[0]?.href).toBe('/pr-42/en/cxx/latest/mcp/tools/snapshot_pane/')
    expect(links.find((entry) => entry.port === 'swift')?.links[0]?.href).toBe('/pr-42/en/swift/latest/mcp/tools/snapshot_pane/')
    expect(pagePortLinks({ ...options, pagePath: 'mcp/tools/missing', portSlug: 'ts' }).every((entry) => !entry.links.length)).toBe(true)
  })

  it('keeps raw tmux commands separate from pane shell commands', () => {
    const swift = pagePortLinks({ ...options, pagePath: 'mcp/tools/run_command', portSlug: 'swift' })
    expect(swift.filter((entry) => entry.links.length).map((entry) => entry.port)).toEqual([])
    const python = pagePortLinks({ ...options, pagePath: 'mcp/tools/run_command', portSlug: 'py' })
    expect(python.find((entry) => entry.port === 'swift')?.links[0]?.href).toBe('/pr-42/en/swift/latest/mcp/tools/run_shell_command/')
    expect(python.find((entry) => entry.port === 'go')?.links[0]?.href).toBe('/pr-42/en/go/latest/mcp/tools/run_shell_command/')
  })

  it('keeps scrollback-only clearing separate from clearing the visible screen', () => {
    const rust = pagePortLinks({ ...options, pagePath: 'mcp/tools/clear_pane_scrollback', portSlug: 'rs' })
    expect(rust.filter((entry) => entry.links.length).map((entry) => entry.port)).toEqual(['ts', 'rs', 'go', 'java', 'dotnet', 'cxx', 'swift'])
    const python = pagePortLinks({ ...options, pagePath: 'mcp/tools/clear_pane', portSlug: 'py' })
    expect(python.find((entry) => entry.port === 'rs')?.links).toEqual([])
    expect(python.find((entry) => entry.port === 'dotnet')?.links).toEqual([])
  })

  it('offers reference indexes rather than transplanting the current reference path', () => {
    expect(pagePortLinks({ ...options, pagePath: 'reference', portSlug: 'ts' }).find((p) => p.port === 'py')?.links[0].href).toBe('/pr-42/en/py/stable/reference/')
  })

  it('links session pane equivalents and disables Java without a direct accessor', () => {
    const links = pagePortLinks({ ...options, pagePath: 'reference/session-session-panes', portSlug: 'ts' })
    expect(links.find((p) => p.port === 'py')?.links[0].href).toBe('/pr-42/en/py/stable/reference/libtmux-session-panes/')
    // The page's own port keeps the version being built, not the default.
    expect(links.find((p) => p.port === 'ts')?.links[0].href).toBe('/pr-42/en/ts/v1.2.3/reference/session-session-panes/')
    expect(links.find((p) => p.port === 'java')?.links).toEqual([])
  })

  it('keeps both scopes when a Swift page documents session and window overloads', () => {
    const links = pagePortLinks({ ...options, pagePath: 'reference/snapshot-panes(of-)', portSlug: 'swift' })
    expect(links.find((p) => p.port === 'py')?.links.map((link) => link.href).sort()).toEqual([
      '/pr-42/en/py/stable/reference/libtmux-session-panes/',
      '/pr-42/en/py/stable/reference/libtmux-window-panes/',
    ])
  })

  it('leaves only the current page enabled for an unmapped symbol', () => {
    const links = pagePortLinks({ ...options, pagePath: 'reference/session-session-sessionbrand', portSlug: 'ts' })
    expect(links.filter((p) => p.links.length).map((p) => p.port)).toEqual(['ts'])
  })
})

describe('locale switcher targets', () => {
  it.each([
    ['/pr-42/ja/mcp/tools/', 'ja', '/pr-42/en/mcp/tools/'],
    ['/pr-42/ja/404/', 'ja', '/pr-42/en/404.html'],
    ['/pr-42/en/ts/latest/404/', 'en', '/pr-42/en/ts/latest/404.html'],
    ['/pr-42/en/dotnet/latest/api/libtmux.client/', 'en', '/pr-42/en/dotnet/latest/api/libtmux.client/'],
  ])('keeps the English counterpart of %s inside its preview', (pathname, locale, expected) => {
    expect(localePageHref('en', localeSourcePath(pathname, locale))).toBe(expected)
  })
})


describe('workspace documentation compatibility', () => {
  it('keeps CLI guides distinct from builder guides', () => {
    const entries = [...docs, { id: 'ports/py/workspace/guides', data: { port: 'py', product: 'workspace' } }]
    const cli = pagePortLinks({ ...options, docs: entries, pagePath: 'workspace/guides', portSlug: 'py' })
    expect(cli.filter((entry) => entry.links.length).map((entry) => entry.port)).toEqual(['py'])
    const internals = pagePortLinks({ ...options, docs: entries, pagePath: 'workspace/internals/guides', portSlug: 'ts' })
    expect(internals.filter((entry) => entry.links.length).map((entry) => entry.port)).toEqual(['ts', 'rs'])
  })

  it('lifts a port without a workspace CLI out of Internals, and leaves Python alone', async () => {
    const { workspaceRedirects } = await import('../src/lib/docs-paths')
    expect(workspaceRedirects([
      'py/stable/workspace/examples', 'py/stable/workspace/internals/examples',
      'go/latest/workspace/internals/examples', 'go/latest/workspace/reference/builder',
      'go/latest/workspace/internals', 'go/latest/guides',
    ])).toEqual([
      { path: 'go/latest/workspace/examples', target: 'go/latest/workspace/internals/examples' },
    ])
    // The reference is its own section now, so there is nothing under
    // Internals for it to be lifted out of.
    expect(workspaceRedirects(['workspace/reference/builder'])).toEqual([])
  })
})
