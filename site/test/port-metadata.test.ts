import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import registry from '../src/data/registry.json'
import { SERVERS } from '../src/lib/install-matrix'
import { installsFor } from '../src/lib/registry'
import { INVENTORY } from '../src/lib/port-inventory'
import { PORT_BY_SLUG, PORTS, hasPackageInstalls, installCommand, portDestinations, portSourceUrl, productAvailable, productDescription, productIsConcept, workspaceInstallGuidance, type DocProduct } from '../src/lib/ports'
import { DESTINATIONS } from './fixtures/port-destinations'

it('keeps explicitly excluded products out of installation and concept navigation', () => {
  const port = { ...PORT_BY_SLUG.go!, productAvailability: { mcp: 'excluded' as const } }
  expect(productAvailable(port, 'mcp')).toBe(false)
  expect(productIsConcept(port, 'mcp')).toBe(false)
  expect(productDescription(port, 'mcp')).toBe('MCP is excluded from this language port.')
  expect(productAvailable(port, 'workspace')).toBe(true)
})

describe('Haskell port metadata', () => {
  it('offers the actual core source and excludes the products it does not ship', () => {
    const haskell = PORT_BY_SLUG.haskell!
    expect(haskell).toMatchObject({
      slug: 'haskell', repo: 'libtmux/libtmux-haskell', packageName: 'libtmux-haskell',
      tagGrammar: 'cabal', renderer: 'astro', source: { path: 'src', ref: 'master' },
      productAvailability: { workspace: 'excluded', mcp: 'excluded' },
    })
    expect(haskell.registry).toBeUndefined()
    expect(haskell.ecosystemHost).toBeUndefined()
    expect(haskell.packages!.map((entry) => entry.id)).toEqual(['core'])
    expect(productAvailable(haskell, 'workspace')).toBe(false)
    expect(productAvailable(haskell, 'mcp')).toBe(false)
    expect(installsFor(haskell)[0]).toMatchObject({ filename: 'cabal.project', lang: 'text' })
    expect(installsFor(haskell)[0].code).toContain('tag: "master"')
    expect(installCommand(haskell, { status: 'unpublished', version: null, release: null, tag: null }).code)
      .toContain('location: https://github.com/libtmux/libtmux-haskell')
    expect(INVENTORY.haskell.map((entry) => [entry.id, entry.status])).toEqual([
      ['libtmux-haskell', 'configured-unpublished'], ['repository', 'published'], ['libtmux-haskell-workspace', 'planned'],
    ])
    const workspace = INVENTORY.haskell[2]
    expect(workspace.path).toBeUndefined()
    expect(workspace.package).toBeUndefined()
    expect(workspace.api).toBeUndefined()
  })
})

describe('Ruby port metadata', () => {
  it('describes the core and companion packages independently', () => {
    const ruby = PORT_BY_SLUG.ruby as (typeof PORT_BY_SLUG)[string] & {
      packages?: Array<{ id: string; name: string; registry: string }>
      productAvailability?: Record<string, string>
    }

    expect(ruby).toMatchObject({
      slug: 'ruby',
      repo: 'libtmux/libtmux-ruby',
      tagGrammar: 'rubygems',
      registry: { name: 'RubyGems', icon: 'rubygems' },
      productAvailability: { mcp: 'available', workspace: 'available' },
    })
    expect(ruby.packages?.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'core', name: 'libtmux' },
      { id: 'async', name: 'libtmux-async' },
      { id: 'mcp', name: 'libtmux-mcp' },
      { id: 'workspace', name: 'libtmux-workspace' },
    ])
    expect(ruby.packages?.every(({ registry }) => registry?.startsWith('https://rubygems.org/gems/'))).toBe(true)
    expect(Object.keys(registry.ports.ruby.packages)).toEqual([
      'libtmux',
      'libtmux-async',
      'libtmux-mcp',
      'libtmux-workspace',
    ])
    // The four gems release together, so each carries the core's version, whatever it is today.
    const gems = Object.values(registry.ports.ruby.packages)
    expect(gems.every((entry) => entry.status === 'release' && entry.version === registry.ports.ruby.version)).toBe(true)
    expect(registry.ports.ruby.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('offers install or build instructions for each available workspace app', () => {
    for (const port of PORTS) {
      expect(hasPackageInstalls(port, 'workspace'), port.slug).toBe(productAvailable(port, 'workspace'))
    }
  })
})

describe('TypeScript port metadata', () => {
  it('runs or installs the published workspace CLI with each package manager', () => {
    const ts = PORT_BY_SLUG.ts!
    expect(ts.workspaceCliAvailability).toBe('published')
    const cli = ts.packages?.find((entry) => entry.id === 'workspace')
    expect(cli).toMatchObject({ name: '@libtmux/workspace-cli', executable: 'tmux-workspace' })
    expect(cli?.installs?.map(({ label }) => label)).toEqual(['npx', 'bunx', 'pnpm dlx', 'yarn dlx', 'npm -g', 'pnpm -g', 'bun -g'])
    expect(cli?.installs?.every(({ code }) => code.includes('@libtmux/workspace-cli'))).toBe(true)
  })
})

describe('Lua port metadata', () => {
  it('excludes companion products that are scaffolds without a server or loader', () => {
    const lua = PORT_BY_SLUG.lua as (typeof PORT_BY_SLUG)[string] & {
      productAvailability?: Record<string, string>
    }

    expect(lua).toMatchObject({
      slug: 'lua',
      repo: 'libtmux/libtmux-lua',
      tagGrammar: 'luarocks',
      registry: { name: 'LuaRocks', icon: 'luarocks' },
      productAvailability: { mcp: 'excluded', workspace: 'excluded' },
    })
    // LuaRocks names a release `<version>-<revision>`; the tag names the version alone.
    const { version } = registry.ports.lua
    expect(version).toMatch(/^\d+\.\d+\.\d+-\d+$/)
    expect(registry.ports.lua).toMatchObject({ status: 'release', release: version, tag: `v${version!.replace(/-\d+$/, '')}` })
  })
})

describe('Julia port metadata', () => {
  /** Every Julia install spelling a reader can copy. */
  function snippets(): Array<[string, string]> {
    const julia = PORT_BY_SLUG.julia!
    const server = SERVERS.julia!
    return [
      ['core', installsFor(julia)[0]!.code],
      ['git form', julia.installForms.git.code],
      ...julia.packages!.map((entry): [string, string] => [entry.id, installsFor({ ...julia, installs: entry.installs! })[0]!.code]),
      ['MCP setup', server.resolve(server.methods[0]!, server.cooldowns[0]!).prereq!],
    ]
  }

  it('keeps core and companions on the default branch without a source selection', () => {
    for (const [name, code] of snippets()) expect(code, `${name} names the branch`).toContain('"master"')
    for (const [name, code] of snippets().filter(([name]) => !['core', 'git form'].includes(name))) {
      expect(code.match(/rev=ref/g), `${name} adds the core and companion at one ref`).toHaveLength(2)
    }
  })

  it('keeps default source installs independent of release tags', () => {
    for (const [name, code] of snippets()) {
      expect(code, `${name} uses the source branch`).not.toMatch(/v\d+\.\d+\.\d+/)
      expect(code, `${name} uses the source branch`).not.toMatch(/\btag\b/)
    }
  })

  it('composes the prompt install command without a tag', () => {
    const julia = PORT_BY_SLUG.julia!
    expect(installCommand(julia, registry.ports.julia as Parameters<typeof installCommand>[1]).code).toBe(julia.installForms.git.code)
  })
})

describe('workspace CLI availability', () => {
  const installs = (slug: string) => PORT_BY_SLUG[slug]!.packages!.find((entry) => entry.id === 'workspace')!.installs!
  const fromCheckout = /--path|\.\/gradlew|\bcmake\b|swift build|git clone/

  it.each(['rs', 'go'])('marks %s published because its registry serves the executable', (slug) => {
    expect(PORT_BY_SLUG[slug]!.workspaceCliAvailability).toBe('published')
    for (const install of installs(slug)) expect(install.code, `${slug} ${install.label}`).not.toMatch(fromCheckout)
  })

  it('installs the Rust crate and the Go command from their registries', () => {
    expect(installs('rs').map(({ code }) => code)).toEqual([
      'cargo install --locked tmux-workspace',
    ])
    expect(installs('go').map(({ code }) => code)).toEqual([
      'go install github.com/libtmux/libtmux-go/workspace/cmd/tmux-workspace@latest',
    ])
  })

  // Java's artifact is a class jar with no launcher, C++ has no registry entry
  // and Swift resolves from Git, so none of them installs the executable.
  it.each(['java', 'cxx', 'swift'])('keeps %s local because a build produces its executable', (slug) => {
    expect(PORT_BY_SLUG[slug]!.workspaceCliAvailability).toBe('local')
  })
})

describe('Perl CPAN publication', () => {
  const perl = PORT_BY_SLUG.perl!
  const package_ = (id: string) => perl.packages!.find((entry) => entry.id === id)!
  const copyable = (port: typeof perl) => [
    ...port.installs.flatMap(({ code, note }) => [code, note ?? '']),
    ...(port.packages ?? []).flatMap((entry) => (entry.installs ?? []).flatMap(({ code, note }) => [code, note ?? ''])),
    ...Object.values(port.installForms).map(({ code }) => code), port.installNote ?? '', port.initProject.code,
  ]

  it('registers MetaCPAN as the package host and its POD as the reference, for the port and for each package', () => {
    expect(perl.registry).toEqual({ name: 'MetaCPAN', url: 'https://metacpan.org/dist/LibTmux', icon: 'cpan' })
    expect(perl.ecosystemHost).toMatchObject({ name: 'MetaCPAN POD', url: 'https://metacpan.org/pod/LibTmux' })
    expect(perl.packages!.map(({ id, registry, reference }) => [id, registry, reference])).toEqual([
      ['core', 'https://metacpan.org/dist/LibTmux', 'https://metacpan.org/pod/LibTmux'],
      ['async', 'https://metacpan.org/dist/LibTmux-Async', 'https://metacpan.org/pod/LibTmux::Async'],
      ['workspace', 'https://metacpan.org/dist/LibTmux-Workspace', 'https://metacpan.org/pod/LibTmux::Workspace'],
    ])
    // The workspace product's page names its own distribution, and keeps the source directory beside it.
    const { source, registry: packageRegistry, ecosystem } = portDestinations({ port: perl, product: 'workspace' })
    expect(packageRegistry).toEqual({ name: 'MetaCPAN', url: 'https://metacpan.org/dist/LibTmux-Workspace', icon: 'cpan' })
    expect(source.url).toBe('https://github.com/libtmux/libtmux-perl/tree/master/packages/workspace')
    expect(ecosystem).toBeUndefined()
  })

  it('installs each distribution from CPAN first and keeps the source checkout as the explicit alternative', () => {
    expect(perl.installs.map(({ label, code }) => [label, code])).toEqual([
      ['cpm', 'cpm install --global LibTmux'],
      ['cpm (source)', 'git clone https://github.com/libtmux/libtmux-perl.git && \\\n  cd libtmux-perl && \\\n  cpm install --global ./packages/core'],
    ])
    expect(package_('async').installs!.map(({ label, code }) => [label, code])).toEqual([
      ['cpm', 'cpm install --global LibTmux::Async'], ['cpm (source)', 'cpm install --global ./packages/async'],
    ])
    expect(package_('workspace').installs!.map(({ label, code }) => [label, code])).toEqual([
      ['cpm', 'cpm install --global LibTmux::Workspace'], ['cpm (source)', 'cpm install --global ./packages/workspace'],
    ])
    expect(perl.installForms.release.code).toBe('cpm install --global LibTmux')
    expect(perl.installForms.git.code).toContain('git clone https://github.com/libtmux/libtmux-perl.git')
    expect(hasPackageInstalls(perl, 'async') && hasPackageInstalls(perl, 'workspace')).toBe(true)
  })

  it('says nothing that calls the distributions unpublished', () => {
    for (const text of copyable(perl)) expect(text).not.toMatch(/unpublished|no cpan release|not published|do not identify published/i)
    expect(workspaceInstallGuidance(perl)).toBe('The `libtmux-workspace` CLI is published to MetaCPAN. Pin its version when automation depends on its output.')
    expect(perl.workspaceCliAvailability).toBe('published')
    expect(productDescription(perl, 'workspace')).toContain('published')
  })

  it('records the CPAN release with its decimal version and tag, not a dotted rewrite of them', () => {
    const entry = registry.ports.perl
    expect(entry).toMatchObject({ status: 'release' })
    expect(entry.version).toMatch(/^\d+\.\d{3}$/)
    expect(entry.tag).toBe(`v${entry.version}`)
    expect(entry.release).toBe(entry.version)
    for (const dist of ['LibTmux', 'LibTmux-Async', 'LibTmux-Workspace']) {
      expect(entry.packages![dist as keyof typeof entry.packages], dist).toMatchObject({ status: 'release', version: entry.version, tag: entry.tag })
    }
    expect(installCommand(perl, entry as Parameters<typeof installCommand>[1]).code).toBe('cpm install --global LibTmux')
  })

  it('keeps MCP excluded and async an optional companion of core', () => {
    expect(perl.productAvailability).toEqual({ workspace: 'available', mcp: 'excluded' })
    expect(productAvailable(perl, 'mcp')).toBe(false)
    expect(perl.packages!.some((entry) => entry.id === 'mcp')).toBe(false)
    expect(new Set(INVENTORY.perl!.map((entry) => entry.product))).toEqual(new Set(['core', 'workspace']))
    expect(package_('async').require).toBe('LibTmux::Async::Server')
    expect(package_('async').installs![0]!.note).toMatch(/Future and IO::Async/)
  })
})

describe('port destinations', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it.each(Object.entries(DESTINATIONS))('resolves the %s source, package and API links', (slug, expected) => {
    const { source, registry: packageRegistry, ecosystem } = portDestinations({ port: PORT_BY_SLUG[slug] })
    expect(source.url).toBe(expected.source.url)
    expect(packageRegistry && { name: packageRegistry.name, url: packageRegistry.url, icon: packageRegistry.icon })
      .toEqual(expected.registry && { name: expected.registry.name, url: expected.registry.url, icon: expected.registry.icon })
    expect(ecosystem && { name: ecosystem.name, url: ecosystem.url })
      .toEqual(expected.api && { name: expected.api.name, url: expected.api.url })
  })

  it('has an expectation for every registered port and no other', () => {
    expect(Object.keys(DESTINATIONS).sort()).toEqual(PORTS.map(({ slug }) => slug).sort())
  })

  it('never offers a second link to the registry URL', () => {
    const go = PORT_BY_SLUG.go!
    expect(go.ecosystemHost?.url).toBe(go.registry?.url)
    expect(portDestinations({ port: go }).ecosystem).toBeUndefined()
    for (const port of PORTS) {
      const { registry: packageRegistry, ecosystem } = portDestinations({ port })
      if (ecosystem) expect(ecosystem.url, port.slug).not.toBe(packageRegistry?.url)
    }
  })

  it('keeps Kotlin, Scala and F# on their own packages and source without parent companions', () => {
    for (const [slug, parent] of [['kotlin', 'java'], ['scala', 'java'], ['fsharp', 'csharp']] as const) {
      const wrapper = portDestinations({ port: PORT_BY_SLUG[slug] })
      const library = portDestinations({ port: PORT_BY_SLUG[parent] })
      expect(wrapper.source.repo, slug).toBe(PORT_BY_SLUG[parent]!.repo)
      expect(wrapper.registry?.url, slug).toContain(PORT_BY_SLUG[slug]!.packageName.split(':').pop())
      expect(wrapper.registry?.url, slug).not.toBe(library.registry?.url)
      expect(wrapper.ecosystem?.url ?? '', slug).not.toBe(library.ecosystem?.url)
      expect(PORT_BY_SLUG[slug]!.packages, slug).toBeUndefined()
      for (const product of ['mcp', 'workspace'] as const) {
        const inherited = portDestinations({ port: PORT_BY_SLUG[slug], product })
        expect(inherited.registry, `${slug} ${product}`).toBeUndefined()
        expect(inherited.source.url, `${slug} ${product}`).toBe(`https://github.com/${wrapper.source.repo}`)
      }
    }
  })

  it('opens a library directory at the revision, tag or default branch', () => {
    const powershell = PORT_BY_SLUG.powershell!
    const tree = (ref: string) => `https://github.com/libtmux/libtmux-powershell/tree/${ref}/src/LibTmux.PowerShell`
    expect(portDestinations({ port: powershell, version: 'latest' }).source).toMatchObject({ url: tree('master'), path: 'src/LibTmux.PowerShell', ref: 'master' })
    expect(portDestinations({ port: powershell, version: 'next' }).source.url).toBe(tree('master'))
    expect(portDestinations({ port: powershell, version: 'v0.1.0-alpha2' }).source).toMatchObject({ url: tree('v0.1.0-alpha2'), ref: 'v0.1.0-alpha2' })
    expect(portDestinations({ port: powershell, version: 'v0.1.0-alpha2', revision: 'abc123' }).source.url).toBe(tree('abc123'))
    expect(portDestinations({ port: powershell, version: 'latest', revision: 'abc123' }).source.url).toBe(tree('abc123'))
    const prefixed = { ...powershell, tagPrefix: 'libtmux@' }
    expect(portDestinations({ port: prefixed, version: 'v1.2.3' }).source.url).toBe(tree('libtmux%40v1.2.3'))
    for (const version of ['latest', 'v1.2.3']) {
      expect(portDestinations({ port: powershell, version, revision: 'abc123' }).source.url).toBe(portSourceUrl(powershell, version, 'abc123'))
    }
  })

  it('points a product in its own repository at that repository and package', () => {
    const py = PORT_BY_SLUG.py!
    const tmuxp = portDestinations({ port: py, product: 'workspace' })
    expect(tmuxp.source).toEqual({ url: 'https://github.com/tmux-python/tmuxp/tree/master/src/tmuxp', repo: 'tmux-python/tmuxp', path: 'src/tmuxp', ref: 'master' })
    expect(tmuxp.registry).toMatchObject({ name: 'PyPI', url: 'https://pypi.org/project/tmuxp/', icon: 'pypi' })
    expect(tmuxp.ecosystem).toBeUndefined()
    const mcp = portDestinations({ port: py, product: 'mcp' })
    expect(mcp.source.url).toBe('https://github.com/tmux-python/libtmux-mcp/tree/main/src/libtmux_mcp')
    expect(mcp.registry?.url).toBe('https://pypi.org/project/libtmux-mcp/')
    // A separate repository has its own releases: the library's tag does not name a ref there.
    expect(portDestinations({ port: py, product: 'workspace', version: 'v0.62.0' }).source.ref).toBe('master')
    expect(portDestinations({ port: py, product: 'workspace', version: 'v0.62.0', revision: 'abc123' }).source.ref).toBe('abc123')
  })

  it('tags a product that shares the library repository with the library version', () => {
    const ts = PORT_BY_SLUG.ts!
    const tree = (ref: string) => `https://github.com/libtmux/libtmux-ts/tree/${ref}/packages/mcp`
    expect(portDestinations({ port: ts, product: 'mcp', version: 'latest', revision: 'abc123' }).source.url).toBe(tree('master'))
    expect(portDestinations({ port: ts, product: 'mcp', version: 'v0.1.0-alpha.12' }).source.url).toBe(tree('v0.1.0-alpha.12'))
    expect(portDestinations({ port: ts, product: 'mcp', version: 'v0.1.0-alpha.12', revision: 'abc123' }).source.url).toBe(tree('v0.1.0-alpha.12'))
    expect(portDestinations({ port: ts, product: 'mcp', version: 'next', revision: 'abc123' }).source.url).toBe(tree('abc123'))
  })

  it('links only the repository for a product without a directory or package', () => {
    const lua = portDestinations({ port: PORT_BY_SLUG.lua, product: 'mcp' })
    expect(lua).toEqual({ source: { url: 'https://github.com/libtmux/libtmux-lua', repo: 'libtmux/libtmux-lua' } })
    const cxx = portDestinations({ port: PORT_BY_SLUG.cxx, product: 'workspace' })
    expect(cxx.source.url).toBe('https://github.com/libtmux/libtmux-cxx/tree/master/apps/workspace')
    expect(cxx.registry).toBeUndefined()
  })

  it('names a project by its repository', () => {
    const project = { name: 'tmux', repo: 'tmux/tmux', homepage: 'https://github.com/tmux/tmux/wiki' }
    expect(portDestinations({ project })).toEqual({ source: { url: 'https://github.com/tmux/tmux', repo: 'tmux/tmux' } })
    expect(() => portDestinations({})).toThrow('a port or project is required')
  })

  it('keeps every external URL free of locale and preview prefixes', async () => {
    vi.stubEnv('LIBTMUX_DOCS_ROOT', '/pr-42/ja')
    vi.stubEnv('LIBTMUX_DOCS_PORT_ROOT', '/pr-42/en')
    vi.stubEnv('LIBTMUX_DOCS_LOCALES_ROOT', '/pr-42')
    vi.resetModules()
    const { PORTS: ports, portDestinations: destinations, portHomeUrl } = await import('../src/lib/ports')
    const { portHeaderLinks } = await import('../src/lib/header-links')
    // The same environment prefixes this site's own routes, so the check can fail.
    expect(portHomeUrl(ports[0]!, 'latest')).toMatch(/^\/pr-42\/en\//)
    for (const port of ports) {
      for (const product of [undefined, 'mcp', 'workspace'] as (DocProduct | undefined)[]) {
        for (const version of ['latest', 'next', 'v1.2.3']) {
          const { source, registry: packageRegistry, ecosystem } = destinations({ port, product, version })
          for (const url of [source.url, packageRegistry?.url, ecosystem?.url]) {
            if (!url) continue
            const { protocol, hostname, pathname } = new URL(url)
            expect([protocol, hostname.endsWith('libtmux.org')], url).toEqual(['https:', false])
            expect(pathname, url).not.toMatch(/^\/(?:pr-\d+\/)?(?:(?:en|ja)\/|pr-\d+\/)/)
            expect(pathname, url).not.toMatch(/\/pr-\d+\//)
          }
        }
      }
      const { actions, rows } = portHeaderLinks(port)
      for (const { url } of [...actions, ...rows]) {
        const { protocol, hostname, pathname } = new URL(url)
        expect([protocol, hostname.endsWith('libtmux.org')], url).toEqual(['https:', false])
        expect(pathname, url).not.toMatch(/^\/(?:pr-\d+\/)?(?:(?:en|ja)\/|pr-\d+\/)/)
      }
    }
  })

  it('loads and resolves under bare Node, which build-site.sh uses', () => {
    const module = new URL('../src/lib/ports.ts', import.meta.url).href
    const inventory = new URL('../src/lib/port-inventory.ts', import.meta.url).href
    const script = `const { PORT_BY_SLUG, portDestinations } = await import(${JSON.stringify(module)}); `
      + `const { INVENTORY } = await import(${JSON.stringify(inventory)}); `
      + 'console.log(JSON.stringify({ ...portDestinations({ port: PORT_BY_SLUG.go }), inventory: Object.keys(INVENTORY).length }))'
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', cwd: fileURLToPath(new URL('..', import.meta.url)) })
    expect(JSON.parse(output)).toMatchObject({
      source: { url: 'https://github.com/libtmux/libtmux-go' },
      registry: { name: 'pkg.go.dev' },
    })
    expect(JSON.parse(output)).not.toHaveProperty('ecosystem')
    // The verification script reads the inventory the same way.
    expect(JSON.parse(output).inventory).toBeGreaterThan(0)
  })
})

describe('install text for the 0.1.0 ports', () => {
  const RELEASED = ['ruby', 'lua', 'powershell', 'elixir', 'ts', 'rs', 'go', 'java', 'kotlin', 'scala', 'csharp', 'fsharp', 'swift']
  const PRERELEASE_TEXT = /alpha|--pre\b|--prerelease|-AllowPrerelease|-Prerelease|every release so far/i

  function handWritten(slug: string): string[] {
    const port = PORT_BY_SLUG[slug]!
    const lists = [port.installs, ...(port.packages ?? []).map((entry) => entry.installs ?? [])]
    const texts = lists.flat().flatMap((install) => [install.code, install.note ?? '', ...(install.additionalBlocks ?? []).map((block) => block.code)])
    const server = SERVERS[slug]
    if (server) for (const method of server.methods) {
      const command = server.resolve(method, { id: 'off' } as never)
      texts.push(command.prereq ?? '', command.note ?? '', ...command.args)
    }
    return texts
  }

  it.each(RELEASED)('carries no alpha version or prerelease flag in the %s install lists', (slug) => {
    for (const text of handWritten(slug)) expect(text, `${slug}: ${text}`).not.toMatch(PRERELEASE_TEXT)
  })

  it('catches a prerelease flag when one is planted', () => {
    expect('dotnet tool install --global LibTmux.Mcp --prerelease').toMatch(PRERELEASE_TEXT)
    expect('gem install --version 0.1.0.alpha.1 libtmux').toMatch(PRERELEASE_TEXT)
  })
})
