import { describe, expect, it, vi } from 'vitest'

vi.stubEnv('LIBTMUX_DOCS_PORT_ROOT', '/pr-42/en')
vi.stubEnv('LIBTMUX_DOCS_LOCALES_ROOT', '/pr-42')
const { docsEntryAvailable, docsEntriesAvailable, pagePortLinks } = await import('../src/lib/page-port-links')
const { PORTS, PORT_BY_SLUG, productAvailable } = await import('../src/lib/ports')
const { referencePageLinks } = await import('../src/lib/reference-page-links')
const { localePageHref, localeSourcePath } = await import('../src/i18n/locales')

const docs = [
  { id: 'concepts/model', data: {} },
  { id: 'guides/python-only', data: { port: 'py' } },
  { id: 'ports/ts/workspace/internals/guides', data: { port: 'ts', product: 'workspace' } },
  { id: 'ports/rs/workspace/internals/guides', data: { port: 'rs', product: 'workspace' } },
]
const options = { version: 'v1.2.3', defaults: { py: 'stable', ts: 'latest' }, docs }

describe('prose route ownership', () => {
  const shared = { id: 'concepts', data: {} }
  const ruby = { id: '_staged/ruby/concepts', data: { port: 'ruby', route: 'concepts' } }
  const lua = { id: '_staged/lua/concepts', data: { port: 'lua', route: 'concepts' } }

  it('selects native prose independently of collection order and keeps shared fallbacks', () => {
    for (const entries of [[shared, ruby, lua], [lua, ruby, shared]]) {
      expect(docsEntriesAvailable(entries, 'ruby')).toEqual([ruby])
      expect(docsEntriesAvailable(entries, 'lua')).toEqual([lua])
      expect(docsEntriesAvailable(entries, 'go')).toEqual([shared])
      expect(docsEntriesAvailable(entries)).toEqual(entries)
    }
  })

  it('keeps locale ownership separate and respects unsupported-port exclusions', () => {
    const translation = { id: 'ja/concepts', data: {} }
    const nativeTranslation = { id: 'ja/_staged/ruby/concepts', data: { port: 'ruby', route: 'concepts' } }
    expect(docsEntriesAvailable([shared, translation, ruby, nativeTranslation], 'ruby')).toEqual([ruby, nativeTranslation])
    expect(docsEntriesAvailable([shared, { ...ruby, data: { ...ruby.data, supportedPorts: ['lua'] } }], 'ruby')).toEqual([shared])
  })

  it('rejects conflicting pages within an owner even when another owner overrides them', () => {
    const duplicate = { id: 'other-concepts', data: { route: 'concepts' } }
    for (const entries of [[shared, ruby, duplicate], [ruby, shared, duplicate], [duplicate, ruby, shared]]) {
      expect(() => docsEntriesAvailable(entries, 'ruby')).toThrow(/Duplicate documentation route concepts/)
    }
    expect(() => docsEntriesAvailable([ruby, { ...ruby, id: 'other-ruby-concepts' }], 'ruby')).toThrow(/_staged\/ruby\/concepts and other-ruby-concepts/)
  })
})

describe('reference picker exits', () => {
  it('keeps missing equivalents distinct from product and language home shortcuts', () => {
    const entries = pagePortLinks({ ...options, pagePath: 'mcp/reference/libtmux-mcp-arguments', portSlug: 'cxx' })
    expect(entries.find((entry) => entry.port === 'rs')).toMatchObject({
      links: [], home: { href: '/pr-42/en/rs/latest/mcp/', label: 'Go to Rust MCP home' },
    })
    expect(entries.find((entry) => entry.port === 'lua')).toMatchObject({
      links: [], home: { href: '/pr-42/en/lua/latest/', label: 'Go to Lua home' },
    })
    expect(entries.find((entry) => entry.port === 'py')?.home?.href).toBe('/pr-42/en/py/stable/mcp/')
    expect(entries.find((entry) => entry.port === 'cxx')?.links[0]?.href).toBe('/pr-42/en/cxx/v1.2.3/mcp/reference/libtmux-mcp-arguments/')
    const workspace = pagePortLinks({ ...options, pagePath: 'workspace/reference/unknown', portSlug: 'powershell' })
    expect(workspace.find((entry) => entry.port === 'powershell')?.home?.href).toBe('/pr-42/en/powershell/v1.2.3/workspace/')
    const core = pagePortLinks({ ...options, pagePath: 'reference/unknown', portSlug: 'rs' })
    expect(core.find((entry) => entry.port === 'rs')?.home?.href).toBe('/pr-42/en/rs/v1.2.3/')
  })

  it('mounts glossary equivalents inside the available API product and preserves the term', () => {
    const entries = pagePortLinks({ ...options, pagePath: 'mcp/reference/glossary', portSlug: 'cxx' })
    expect(entries.find((entry) => entry.port === 'cxx')?.links).toEqual([
      { href: '/pr-42/en/cxx/v1.2.3/mcp/reference/glossary/', preserveFragment: true },
    ])
    expect(entries.find((entry) => entry.port === 'julia')?.links).toEqual([
      { href: '/pr-42/en/julia/latest/mcp/reference/glossary/', preserveFragment: true },
    ])
    expect(entries.find((entry) => entry.port === 'powershell')?.links).toEqual([])
    const core = pagePortLinks({ ...options, pagePath: 'reference/glossary', portSlug: 'rs' })
    expect(core.find((entry) => entry.port === 'py')?.links).toEqual([
      { href: '/pr-42/en/py/stable/reference/glossary/', preserveFragment: true },
    ])
  })
})

describe('matching pages in another port', () => {
  it('links cmdlet switches to parameters and keeps Julia receiver names out of function links', async () => {
    const { referenceAlternatives, API_MODELS } = await import('../src/lib/api-models')
    const { productApiIndex } = await import('../src/lib/product-api')
    const { parameterId } = await import('@libtmux/api-model')
    const examples = [
      ['julia', 'LibTmux.snapshot', 'Depth'], ['cxx', 'libtmux::Session::windows', 'Session'],
      ['cxx', 'libtmux::Window::panes', 'Window'], ['cxx', 'libtmux::Server::sessions', 'Server'],
    ]
    for (const [port, id, name] of examples) {
      const entry = referenceAlternatives(port, id).flatMap((group) => group.ports).find((entry) => entry.port === 'powershell')!
      const target = API_MODELS.powershell.symbols.find((symbol) => symbol.id === entry.publicId)!
      const spans = productApiIndex(API_MODELS.powershell, 'latest').linkText(entry.note!)
      const link = spans.find((span) => span.kind === 'link' && span.text === `-${name}`)
      expect(link, `${id}: -${name}`).toMatchObject({ href: entry.href + '#' + encodeURIComponent(parameterId(target, name)), code: true })
      expect(spans.some((span) => span.kind === 'ref' && span.target === `-${name}`)).toBe(false)
    }
    for (const id of ['LibTmux.windows', 'LibTmux.panes', 'LibTmux.sessions', 'LibTmux.clients']) {
      const entries = referenceAlternatives('julia', id).flatMap((group) => group.ports).filter((entry) => entry.port === 'julia')
      for (const entry of entries) {
        const index = productApiIndex(API_MODELS.julia, 'latest')
        const spans = index.linkText(entry.note!)
        expect(spans.filter((span) => span.kind === 'ref').every((span) => span.link)).toBe(true)
        const links = spans.flatMap((span) => span.kind === 'ref' && span.link ? [span.link.href] : [])
        expect(links.some((href) => /libtmux-(session|window|snapshot)\/$/.test(href))).toBe(false)
      }
    }
  })

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

  it('links server types to verified Julia types, PowerShell cmdlets and F# modules in both directions', () => {
    const pages = [
      ['cxx', 'libtmux-server'], ['julia', 'libtmux-server'],
      ['powershell', 'libtmux-new-tmuxserver'], ['fsharp', 'libtmux-fsharp-server'],
    ]
    for (const [portSlug, slug] of pages) {
      const entries = pagePortLinks({ ...options, portSlug, pagePath: `reference/${slug}` })
      for (const [port, target] of pages) {
        const version = port === portSlug ? options.version : options.defaults[port as keyof typeof options.defaults] ?? 'latest'
        expect(entries.find((entry) => entry.port === port)?.links[0].href).toBe(`/pr-42/en/${port}/${version}/reference/${target}/`)
      }
      if (portSlug !== 'powershell') expect(entries.find((entry) => entry.port === 'powershell')?.links[0].label).toBe('New-TmuxServer (cmdlet)')
      if (portSlug !== 'fsharp') expect(entries.find((entry) => entry.port === 'fsharp')?.links[0].label).toBe('Server (module)')
    }
  })

  it('omits repeated task captions while keeping native distinctions and missing exits', () => {
    const entries = pagePortLinks({ ...options, portSlug: 'cxx', pagePath: 'reference/libtmux-server-sessions' })
    for (const port of ['py', 'ruby', 'lua', 'ts', 'rs', 'go', 'swift', 'java', 'kotlin', 'scala', 'csharp']) {
      const links = entries.find((entry) => entry.port === port)!.links
      expect(links, port).toHaveLength(1)
      expect(links[0], port).not.toHaveProperty('label')
    }
    expect(entries.find((entry) => entry.port === 'julia')?.links[0]).toMatchObject({
      href: '/pr-42/en/julia/latest/reference/libtmux-sessions/', label: 'sessions (function)',
    })
    expect(entries.find((entry) => entry.port === 'powershell')?.links[0].label).toContain('(cmdlet)')
    expect(entries.find((entry) => entry.port === 'fsharp')?.links[0].label).toBeTruthy()
    expect(entries.every((entry) => entry.links.every((link) => link.label !== 'List the server’s sessions'))).toBe(true)
  })

  it('finds library counterparts from the tmux prose namespace', () => {
    const links = pagePortLinks({ ...options, pagePath: 'tmux/concepts/model' })
    expect(links.find((p) => p.port === 'go')?.links[0].href).toBe('/pr-42/en/go/latest/concepts/model/')
    expect(links.every((entry) => entry.links.every((link) => !link.href.includes('/latest/tmux/')))).toBe(true)
  })
  it('uses native equivalents when a shared article does not cover a port', () => {
    const shared = { id: 'topics/pane-interaction', data: { supportedPorts: ['go', 'py'] } }
    const native = { id: '_staged/lua/guides/panes', data: { port: 'lua', route: 'guides/panes', aliases: ['topics/pane-interaction'] } }
    expect(docsEntryAvailable(shared, 'lua')).toBe(false)
    expect(docsEntryAvailable(shared, 'go')).toBe(true)
    const links = pagePortLinks({ ...options, docs: [shared, native], pagePath: 'topics/pane-interaction', portSlug: 'go' })
    expect(links.find((p) => p.port === 'lua')?.links[0].href).toBe('/pr-42/en/lua/latest/guides/panes/')
    expect(links.find((p) => p.port === 'ruby')?.links).toEqual([])
    const reverse = pagePortLinks({ ...options, docs: [shared, native], pagePath: 'guides/panes', portSlug: 'lua' })
    expect(reverse.find((p) => p.port === 'go')?.links[0].href).toBe('/pr-42/en/go/latest/topics/pane-interaction/')
  })
  it('switches product guides only where the matching page is authored', () => {
    const links = pagePortLinks({ ...options, pagePath: 'workspace/internals/guides', portSlug: 'ts' })
    expect(links.find((p) => p.port === 'ts')?.links[0].href).toBe('/pr-42/en/ts/v1.2.3/workspace/internals/guides/')
    expect(links.find((p) => p.port === 'rs')?.links[0].href).toBe('/pr-42/en/rs/latest/workspace/internals/guides/')
    expect(links.find((p) => p.port === 'py')?.links).toEqual([])
  })

  it('matches verified setup tasks across native and authored routes in both directions', () => {
    const page = (port: string, route: string, title: string, equivalence = 'mcp-client-setup', product = 'mcp') => ({
      id: `ports/${port}/${route}`, data: { port, route, title, product, equivalence, sidebar: { group: 'Guides' } },
    })
    const entries = [
      page('julia', 'mcp/source-guide', 'MCP server guide'),
      page('ruby', 'mcp/source-guide', 'MCP server guide'),
      page('ruby', 'mcp/guides/connect-client', 'Connect a client'),
      page('go', 'mcp/guides/connect-client', 'Connect a client'),
      page('go', 'mcp/guides', 'Overview', ''),
      page('py', 'mcp/guides', 'Connect a Python MCP client'),
      page('ts', 'mcp/source-guide', 'Unrelated task', 'mcp-observation'),
      page('ts', 'mcp/guides', 'Overview', ''),
      page('java', 'workspace/source-guide', 'Different product', 'mcp-client-setup', 'workspace'),
      page('lua', 'mcp/source-guide', 'Unsupported server'),
      page('powershell', 'mcp/source-guide', 'Unsupported server'),
    ]
    for (const docs of [entries, [...entries].reverse()]) {
      const links = pagePortLinks({ ...options, docs, pagePath: 'mcp/source-guide', portSlug: 'julia' })
      expect(links.find((p) => p.port === 'julia')?.links).toEqual([{ href: '/pr-42/en/julia/v1.2.3/mcp/source-guide/' }])
      expect(links.find((p) => p.port === 'go')?.links).toEqual([{ href: '/pr-42/en/go/latest/mcp/guides/connect-client/' }])
      expect(links.find((p) => p.port === 'py')?.links).toEqual([{ href: '/pr-42/en/py/stable/mcp/guides/' }])
      expect(links.find((p) => p.port === 'ruby')?.links).toEqual([
        { href: '/pr-42/en/ruby/latest/mcp/guides/connect-client/', label: 'Connect a client' },
        { href: '/pr-42/en/ruby/latest/mcp/source-guide/', label: 'MCP server guide' },
      ])
      expect(links.find((p) => p.port === 'ts')?.links).toEqual([{ href: '/pr-42/en/ts/latest/mcp/guides/', label: 'Guides overview', fallback: 'section' }])
      for (const port of ['java', 'lua', 'powershell']) expect(links.find((p) => p.port === port)?.links).toEqual([])
      for (const [portSlug, pagePath] of [['ruby', 'mcp/guides/connect-client'], ['py', 'mcp/guides']]) {
        const reverse = pagePortLinks({ ...options, docs, pagePath, portSlug })
        expect(reverse.find((p) => p.port === 'julia')?.links).toEqual([{ href: '/pr-42/en/julia/latest/mcp/source-guide/' }])
        expect(reverse.find((p) => p.port === portSlug)?.links).toEqual([{ href: `/pr-42/en/${portSlug}/v1.2.3/${pagePath}/` }])
      }
    }
  })

  it('keeps a missing product article fallback in its real section', () => {
    const docs = [
      { id: 'ports/ts/workspace/internals/guides/special', data: { port: 'ts', product: 'workspace' } },
      { id: 'ports/go/workspace/internals/guides', data: { port: 'go', product: 'workspace' } },
      { id: 'ports/rs/workspace/guides', data: { port: 'rs', product: 'workspace' } },
    ]
    const links = pagePortLinks({ ...options, docs, pagePath: 'workspace/internals/guides/special', portSlug: 'ts' })
    expect(links.find((p) => p.port === 'go')?.links).toEqual([{ href: '/pr-42/en/go/latest/workspace/internals/guides/', label: 'Guides overview', fallback: 'section' }])
    expect(links.find((p) => p.port === 'rs')?.links).toEqual([])
  })
  it('preserves the prose page and chooses the target port default', () => {
    const links = pagePortLinks({ ...options, pagePath: 'concepts/model', portSlug: 'py' })
    expect(links.find((p) => p.port === 'py')?.links[0].href).toBe('/pr-42/en/py/v1.2.3/concepts/model/')
    expect(links.find((p) => p.port === 'ts')?.links[0].href).toBe('/pr-42/en/ts/latest/concepts/model/')
  })

  it('labels an existing section overview when a port has no matching example', () => {
    const entries = [
      { id: 'ports/powershell/examples/create-layout', data: { port: 'powershell', route: 'examples/create-layout' } },
      { id: 'ports/julia/examples/create-layout', data: { port: 'julia', route: 'examples/create-layout' } },
      { id: 'ports/csharp/examples', data: { port: 'csharp', route: 'examples' } },
      { id: 'ports/fsharp/examples', data: { port: 'fsharp', route: 'examples' } },
    ]
    const links = pagePortLinks({ ...options, docs: entries, pagePath: 'examples/create-layout', portSlug: 'powershell' })
    expect(links.find((entry) => entry.port === 'powershell')?.links).toEqual([{ href: '/pr-42/en/powershell/v1.2.3/examples/create-layout/' }])
    expect(links.find((entry) => entry.port === 'julia')?.links).toEqual([{ href: '/pr-42/en/julia/latest/examples/create-layout/' }])
    for (const port of ['csharp', 'fsharp']) expect(links.find((entry) => entry.port === port)?.links).toEqual([
      { href: `/pr-42/en/${port}/latest/examples/`, label: 'Examples overview', fallback: 'section' },
    ])
    expect(links.find((entry) => entry.port === 'java')?.links).toEqual([])
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
    expect(links.filter((entry) => entry.links.some((link) => !link.label)).map((entry) => entry.port).sort())
      .toEqual(['py', 'ts', 'rs', 'go', 'java', 'csharp', 'cxx', 'swift', 'julia'].sort())
    expect(links.find((entry) => entry.port === 'ruby')?.links).toEqual([{ href: '/pr-42/en/ruby/latest/mcp/tools/', label: 'Tools overview', fallback: 'section' }])
    expect(links.find((entry) => entry.port === 'ts')?.links[0].href).toBe('/pr-42/en/ts/v1.2.3/mcp/tools/capture_pane/')
    expect(links.find((entry) => entry.port === 'py')?.links[0].href).toBe('/pr-42/en/py/stable/mcp/tools/capture_pane/')
    expect(links.find((entry) => entry.port === 'csharp')?.links[0].href).toBe('/pr-42/en/csharp/latest/mcp/tools/capture_pane/')
    expect(links.find((entry) => entry.port === 'julia')?.links[0].href).toBe('/pr-42/en/julia/latest/mcp/tools/capture_pane/')
    const reverse = pagePortLinks({ ...options, pagePath: 'mcp/tools/capture_pane', portSlug: 'csharp' })
    expect(reverse.find((entry) => entry.port === 'ts')?.links[0].href).toBe('/pr-42/en/ts/latest/mcp/tools/capture_pane/')
  })

  it('links the current snapshot tool across ports and rejects unknown tools', () => {
    const links = pagePortLinks({ ...options, pagePath: 'mcp/tools/snapshot_pane', portSlug: 'ts' })
    expect(links.find((entry) => entry.port === 'py')?.links[0]?.href).toBe('/pr-42/en/py/stable/mcp/tools/snapshot_pane/')
    expect(links.find((entry) => entry.port === 'cxx')?.links[0]?.href).toBe('/pr-42/en/cxx/latest/mcp/tools/snapshot_pane/')
    expect(links.find((entry) => entry.port === 'swift')?.links[0]?.href).toBe('/pr-42/en/swift/latest/mcp/tools/snapshot_pane/')
    expect(pagePortLinks({ ...options, pagePath: 'mcp/tools/missing', portSlug: 'ts' }).every((entry) => !entry.links.length)).toBe(true)
  })

  it('rejects retired raw tmux commands and links current pane shell commands', () => {
    const swift = pagePortLinks({ ...options, pagePath: 'mcp/tools/run_command', portSlug: 'swift' })
    expect(swift.filter((entry) => entry.links.length).map((entry) => entry.port)).toEqual([])
    const python = pagePortLinks({ ...options, pagePath: 'mcp/tools/run_command', portSlug: 'py' })
    expect(python.find((entry) => entry.port === 'swift')?.links[0]?.href).toBe('/pr-42/en/swift/latest/mcp/tools/run_shell_command/')
    expect(python.find((entry) => entry.port === 'go')?.links[0]?.href).toBe('/pr-42/en/go/latest/mcp/tools/run_shell_command/')
  })

  it('keeps scrollback-only clearing separate from clearing the visible screen', () => {
    const rust = pagePortLinks({ ...options, pagePath: 'mcp/tools/clear_pane_scrollback', portSlug: 'rs' })
    expect(rust.filter((entry) => entry.links.some((link) => !link.label)).map((entry) => entry.port)).toEqual(['ts', 'rs', 'go', 'java', 'csharp', 'cxx', 'swift'])
    expect(rust.find((entry) => entry.port === 'py')?.links).toEqual([{ href: '/pr-42/en/py/stable/mcp/tools/', label: 'Tools overview', fallback: 'section' }])
    const python = pagePortLinks({ ...options, pagePath: 'mcp/tools/clear_pane', portSlug: 'py' })
    for (const port of ['rs', 'csharp']) expect(python.find((entry) => entry.port === port)?.links).toEqual([
      { href: `/pr-42/en/${port}/latest/mcp/tools/`, label: 'Tools overview', fallback: 'section' },
    ])
  })

  it('switches fixed resources by URI despite different display names', () => {
    const links = pagePortLinks({ ...options, pagePath: 'mcp/resources/capabilities', portSlug: 'ts' })
    expect(links.find((entry) => entry.port === 'go')?.links).toEqual([{ href: '/pr-42/en/go/latest/mcp/resources/tmux-capabilities/' }])
    expect(links.find((entry) => entry.port === 'csharp')?.links).toEqual([{ href: '/pr-42/en/csharp/latest/mcp/resources/tmux_capabilities/' }])
    expect(links.find((entry) => entry.port === 'py')?.links).toEqual([{ href: '/pr-42/en/py/stable/mcp/resources/', label: 'Resources overview', fallback: 'section' }])
    expect(links.find((entry) => entry.port === 'julia')?.links).toEqual([{ href: '/pr-42/en/julia/latest/mcp/resources/', label: 'Resources overview', fallback: 'section' }])
  })

  it.each([
    ['mcp/prompts/run_and_wait', 'Prompts'],
    ['mcp/resources/templates/get_pane', 'Resources'],
  ])('offers an explicitly labelled section when %s has no counterpart', (pagePath, section) => {
    const links = pagePortLinks({ ...options, pagePath, portSlug: 'py' })
    expect(links.find((entry) => entry.port === 'py')?.links).toEqual([{ href: `/pr-42/en/py/v1.2.3/${pagePath}/` }])
    expect(links.find((entry) => entry.port === 'ts')?.links).toEqual([{ href: `/pr-42/en/ts/latest/mcp/${section.toLowerCase()}/`, label: `${section} overview`, fallback: 'section' }])
    expect(links.find((entry) => entry.port === 'powershell')?.links).toEqual([])
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
    ['/pr-42/en/csharp/latest/api/libtmux.client/', 'en', '/pr-42/en/csharp/latest/api/libtmux.client/'],
  ])('keeps the English counterpart of %s inside its preview', (pathname, locale, expected) => {
    expect(localePageHref('en', localeSourcePath(pathname, locale))).toBe(expected)
  })
})


describe('workspace documentation compatibility', () => {
  it.each(['cli/load', 'configuration/commands', 'reference/compatibility', 'guides/automation', 'examples/gallery'])(
    'switches the nested %s reference across authored ports', (section) => {
      const pagePath = `workspace/${section}`
      const entries = PORTS.filter((port) => !port.parentLibrary).map((port) => ({
        id: `ports/${port.slug}/${pagePath}`, data: { port: port.slug, product: 'workspace' },
      }))
      const links = pagePortLinks({ ...options, docs: entries, pagePath, portSlug: 'go' })
      for (const entry of links) {
        const version = entry.port === 'go' ? 'v1.2.3' : entry.port === 'py' ? 'stable' : 'latest'
        expect(entry.links).toEqual(productAvailable(PORT_BY_SLUG[entry.port], 'workspace') ? [{ href: `/pr-42/en/${entry.port}/${version}/${pagePath}/` }] : [])
      }
      const missing = pagePortLinks({ ...options, pagePath, docs: entries.filter((entry) => entry.data.port !== 'cxx') })
      expect(missing.find((entry) => entry.port === 'cxx')?.links).toEqual([])
    },
  )

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


it('marks only real fallback sections on Julia ownership and preserves the selected version and target defaults', () => {
  const entries = [
    { id: '_staged/julia/topics/ownership', data: { port: 'julia', route: 'topics/ownership' } },
    { id: 'topics', data: {} },
    { id: 'ports/ruby/topics/ownership', data: { port: 'ruby', route: 'topics/ownership' } },
  ]
  const links = pagePortLinks({ ...options, docs: entries, pagePath: 'topics/ownership', portSlug: 'julia' })
  expect(links.find((entry) => entry.port === 'julia')?.links).toEqual([{ href: '/pr-42/en/julia/v1.2.3/topics/ownership/' }])
  expect(links.find((entry) => entry.port === 'ruby')?.links).toEqual([{ href: '/pr-42/en/ruby/latest/topics/ownership/' }])
  expect(links.find((entry) => entry.port === 'py')?.links).toEqual([
    { href: '/pr-42/en/py/stable/topics/', label: 'Topics overview', fallback: 'section' },
  ])
  const withoutOverview = pagePortLinks({ ...options, docs: entries.filter((entry) => entry.id !== 'topics'),
    pagePath: 'topics/ownership', portSlug: 'julia' })
  expect(withoutOverview.find((entry) => entry.port === 'py')?.links).toEqual([])
  expect(withoutOverview.find((entry) => entry.port === 'py')?.home).toEqual({
    href: '/pr-42/en/py/stable/', label: 'Go to Python home',
  })
})
