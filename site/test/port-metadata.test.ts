import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import registry from '../src/data/registry.json'
import { SERVERS } from '../src/lib/install-matrix'
import { installsFor } from '../src/lib/registry'
import { PORT_BY_SLUG, PORTS, hasPackageInstalls, installCommand, portDestinations, portSourceUrl, productAvailable, type DocProduct } from '../src/lib/ports'
import { DESTINATIONS } from './fixtures/port-destinations'

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
    expect(Object.values(registry.ports.ruby.packages).every((entry) => entry.version === '0.1.0.alpha.1')).toBe(true)
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
  it('marks unimplemented companion products as unpublished', () => {
    const lua = PORT_BY_SLUG.lua as (typeof PORT_BY_SLUG)[string] & {
      productAvailability?: Record<string, string>
    }

    expect(lua).toMatchObject({
      slug: 'lua',
      repo: 'libtmux/libtmux-lua',
      tagGrammar: 'luarocks',
      registry: { name: 'LuaRocks', icon: 'luarocks' },
      productAvailability: { mcp: 'unpublished', workspace: 'unpublished' },
    })
    expect(registry.ports.lua).toMatchObject({
      status: 'prerelease',
      version: '0.1.0alpha1-1',
      stable: null,
      tag: 'v0.1.0alpha1',
    })
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
      expect.stringMatching(/^cargo install --locked --version 0\.1\.0-alpha\.\d+ tmux-workspace$/),
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
    expect(portDestinations({ port: powershell, version: 'stable' }).source.url).toBe(tree('master'))
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
    expect(portDestinations({ port: ts, product: 'mcp', version: 'stable', revision: 'abc123' }).source.url).toBe(tree('abc123'))
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
        for (const version of ['latest', 'stable', 'v1.2.3']) {
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
