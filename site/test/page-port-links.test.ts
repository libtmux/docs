import { describe, expect, it, vi } from 'vitest'

vi.stubEnv('LIBTMUX_DOCS_PORT_ROOT', '/pr-42/en')
vi.stubEnv('LIBTMUX_DOCS_LOCALES_ROOT', '/pr-42')
const { pagePortLinks } = await import('../src/lib/page-port-links')
const { localePageHref, localeSourcePath } = await import('../src/i18n/locales')

const docs = [
  { id: 'concepts/model', data: {} },
  { id: 'guides/python-only', data: { port: 'py' } },
]
const options = { version: 'v1.2.3', defaults: { py: 'stable', ts: 'latest' }, docs }

describe('matching pages in another port', () => {
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

  it('offers reference indexes rather than transplanting the current reference path', () => {
    expect(pagePortLinks({ ...options, pagePath: 'reference/ts' }).find((p) => p.port === 'py')?.links[0].href).toBe('/pr-42/en/reference/py/')
  })

  it('links session pane equivalents and disables Java without a direct accessor', () => {
    const links = pagePortLinks({ ...options, pagePath: 'reference/ts/session-session-panes' })
    expect(links.find((p) => p.port === 'py')?.links[0].href).toBe('/pr-42/en/reference/py/libtmux-session-panes/')
    expect(links.find((p) => p.port === 'ts')?.links[0].href).toBe('/pr-42/en/reference/ts/session-session-panes/')
    expect(links.find((p) => p.port === 'java')?.links).toEqual([])
  })

  it('keeps both scopes when a Swift page documents session and window overloads', () => {
    const links = pagePortLinks({ ...options, pagePath: 'reference/swift/snapshot-panes(of-)' })
    expect(links.find((p) => p.port === 'py')?.links.map((link) => link.href).sort()).toEqual([
      '/pr-42/en/reference/py/libtmux-session-panes/',
      '/pr-42/en/reference/py/libtmux-window-panes/',
    ])
  })

  it('leaves only the current page enabled for an unmapped symbol', () => {
    const links = pagePortLinks({ ...options, pagePath: 'reference/ts/session-session-sessionbrand' })
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
