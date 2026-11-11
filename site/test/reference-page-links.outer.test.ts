import { expect, it, vi } from 'vitest'

vi.stubEnv('LIBTMUX_DOCS_PORT_ROOT', '/pr-42/en')
vi.stubEnv('LIBTMUX_DOCS_LOCALES_ROOT', '/pr-42')
const { referencePageLinks } = await import('../src/lib/reference-page-links')

// Publishing this manifest resolves concepts across the complete API catalog.
it('publishes native differences and reverse links for Julia action references', () => {
  const manifest = referencePageLinks()
  const server = manifest.symbols.cxx['libtmux::Server']
  expect(server.find((entry) => entry.port === 'powershell')).toMatchObject({
    kind: 'cmdlet', href: '/pr-42/en/powershell/latest/reference/libtmux-new-tmuxserver/',
    note: expect.stringContaining('shared .NET `LibTmux.Server`'),
  })
  expect(server.find((entry) => entry.port === 'fsharp')).toMatchObject({ kind: 'module' })
  expect(manifest.symbols.julia['LibTmux.SessionRef']).toEqual(expect.arrayContaining([
    expect.objectContaining({ port: 'cxx', href: '/pr-42/en/cxx/latest/reference/libtmux-session/' }),
  ]))
})
