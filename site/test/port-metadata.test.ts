import { describe, expect, it } from 'vitest'
import registry from '../src/data/registry.json'
import { SERVERS } from '../src/lib/install-matrix'
import { PORT_BY_SLUG, PORTS, hasPackageInstalls, installCommand, productAvailable } from '../src/lib/ports'

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
      ['core', julia.installs[0]!.code],
      ['git form', julia.installForms.git.code],
      ...julia.packages!.map((entry): [string, string] => [entry.id, entry.installs![0]!.code]),
      ['MCP setup', server.resolve(server.methods[0]!, server.cooldowns[0]!).prereq!],
    ]
  }

  it('installs from the default branch because the repository has no release tag', () => {
    expect(registry.ports.julia).toMatchObject({ status: 'unpublished', version: null, stable: null, tag: null })
    for (const [name, code] of snippets()) expect(code, `${name} names the branch`).toContain('"master"')
    for (const [name, code] of snippets().filter(([name]) => !['core', 'git form'].includes(name))) {
      expect(code.match(/rev=ref/g), `${name} adds the core and companion at one ref`).toHaveLength(2)
    }
  })

  it('names no release tag that was never pushed', () => {
    for (const [name, code] of snippets()) {
      expect(code, `${name} cites a nonexistent tag`).not.toMatch(/v\d+\.\d+\.\d+/)
      expect(code, `${name} cites a nonexistent tag`).not.toMatch(/\btag\b/)
    }
  })

  it('composes the prompt install command without a tag', () => {
    const julia = PORT_BY_SLUG.julia!
    expect(installCommand(julia, registry.ports.julia as Parameters<typeof installCommand>[1]).code).toBe(julia.installForms.git.code)
  })
})
