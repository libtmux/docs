import { describe, expect, it } from 'vitest'
import evidence from '../src/data/destination-evidence.json'
import { portHeaderLinks } from '../src/lib/header-links'
import { INVENTORY } from '../src/lib/port-inventory'
import { PORT_BY_SLUG, installCommand, portDestinations } from '../src/lib/ports'
import { installsFor, registryFor } from '../src/lib/registry'

/**
 * Where each package's registry destination and install command come from.
 *
 * A package with no registry release gets no registry link, no registry
 * install and no `published` status; its source install is the only install.
 * The registry's answer for each is recorded in `scripts/gen-registry.mjs`
 * and `destination-evidence.json`; these tests hold the site's own tables to it.
 */

/**
 * Per port with no registry release: the spelling that would resolve its
 * package from the ecosystem's registry, and what every install must name instead.
 */
const SOURCE_ONLY: Record<string, { registryInstall: RegExp; source?: string }> = {
  julia: { registryInstall: /Pkg\.add\("LibTmux"\)|PackageSpec\(name=/, source: 'libtmux/libtmux-julia.git' },
  ocaml: { registryInstall: /\bopam\s+(?:install|pin\s+add)\s+libtmux/ },
  haskell: { registryInstall: /^build-depends:|cabal\s+install\s+libtmux/m, source: 'libtmux/libtmux-haskell' },
  lisp: { registryInstall: /ql:quickload|ros\s+install|qlot\s+add\s+libtmux/ },
}

/** Every command a reader or a prompt can be handed for a port's core package. */
const coreInstalls = (slug: string) => {
  const port = PORT_BY_SLUG[slug]!
  return [...port.installs.map(({ label, code }) => [`installs ${label}`, code] as const),
    ...Object.entries(port.installForms).map(([form, { code }]) => [`installForms.${form}`, code] as const)]
}

describe.each(Object.keys(SOURCE_ONLY))('%s, which no registry carries', (slug) => {
  const { registryInstall, source } = SOURCE_ONLY[slug]!

  it('offers no registry install in any form', () => {
    for (const [where, code] of coreInstalls(slug)) expect(code, where).not.toMatch(registryInstall)
  })

  it.skipIf(!source)('names its source in every install form', () => {
    for (const [where, code] of coreInstalls(slug)) expect(code, where).toContain(source!)
  })

  it('names no registry for the port', () => {
    expect(PORT_BY_SLUG[slug]!.registry).toBeUndefined()
    expect(PORT_BY_SLUG[slug]!.ecosystemHost).toBeUndefined()
  })

  it('records every package as available from source, never as published', () => {
    const packages = INVENTORY[slug]!.filter(({ kind }) => kind !== 'source')
    expect(packages.length).toBeGreaterThan(0)
    for (const entry of packages) {
      // A planned entry is declared but not yet in the repository, so it links nothing.
      expect(['configured-unpublished', 'planned'], entry.id).toContain(entry.status)
      if (entry.status === 'configured-unpublished') expect(entry.sourceAvailable, entry.id).toBe(true)
      expect(entry.note, entry.id).toBeTruthy()
      expect(entry.package ?? entry.api, entry.id).toBeUndefined()
    }
    // The public repository itself is what is published.
    for (const entry of INVENTORY[slug]!.filter(({ kind }) => kind === 'source')) expect(entry.status, entry.id).toBe('published')
  })

  it('links only source from the header', () => {
    const links = portHeaderLinks(PORT_BY_SLUG[slug]!)
    expect(links.actions.map(({ kind }) => kind)).toEqual(['source'])
    expect(links.rows.every(({ kind }) => kind === 'source')).toBe(true)
  })
})

describe('Julia companions', () => {
  const julia = PORT_BY_SLUG.julia!

  it('offer only the Git install, with no registry spelling', () => {
    for (const pkg of julia.packages!) {
      for (const { label, code } of pkg.installs!) {
        expect(pkg.registry, pkg.name).toBeUndefined()
        expect(code, `${pkg.name} ${label}`).toContain('url=repo')
        expect(code, `${pkg.name} ${label}`).not.toMatch(SOURCE_ONLY.julia!.registryInstall)
      }
    }
  })
})

describe('Erlang, released on Hex as libtmux_erlang', () => {
  const erlang = PORT_BY_SLUG.erlang!
  const hex = 'https://hex.pm/packages/libtmux_erlang'
  const library = INVENTORY.erlang!.find(({ kind }) => kind === 'library')!

  it('names Hex as the registry', () => {
    expect(erlang.registry).toEqual({ name: 'Hex', url: hex, icon: 'hex' })
    expect(portDestinations({ port: erlang }).registry?.url).toBe(hex)
    expect(registryFor(erlang)).toMatchObject({ status: 'release', release: '0.0.1', tag: 'v0.0.1' })
  })

  it('links no HexDocs reference, because Hex carries no documentation for the package', () => {
    expect(erlang.ecosystemHost).toBeUndefined()
    expect(INVENTORY.erlang!.filter(({ api }) => api)).toEqual([])
    expect(portHeaderLinks(erlang).actions.map(({ kind }) => kind)).toEqual(['source', 'package'])
  })

  it('records the library as published on Hex, with a passing record', () => {
    expect(library).toMatchObject({ status: 'published', coordinate: 'libtmux_erlang', package: { host: 'hex', url: hex } })
    const record = evidence.destinations.find(({ url }) => url === hex)
    expect(record).toMatchObject({ ok: true, status: 200, identity: 'libtmux_erlang', repository: 'libtmux/libtmux-erlang' })
  })

  it('installs the Hex release first and keeps Git as the explicit alternative', () => {
    const release = '{deps, [{libtmux_erlang, "0.0.1"}]}.'
    expect(installCommand(erlang, registryFor(erlang)).code).toBe(release)
    const [hexTab, gitTab, ...rest] = installsFor(erlang)
    expect(rest).toEqual([])
    expect(hexTab).toMatchObject({ lang: 'erlang', filename: 'rebar.config', code: release })
    expect(gitTab!.code).toContain('git_subdir')
    expect(gitTab!.code).toContain('https://github.com/libtmux/libtmux-erlang.git')
    expect(erlang.installForms.git.code).toContain('git_subdir')
    for (const { code, additionalBlocks } of installsFor(erlang)) {
      expect([code, ...(additionalBlocks ?? []).map((block) => block.code)].join('\n')).not.toMatch(/\{(?:version|revision)\}/)
    }
  })

  it('shows the Hex release on the port page, without an Elixir tuple or a range to pin', async () => {
    const { Window } = await import('happy-dom')
    const { createComponent, renderTemplate } = await import('astro/runtime/server/index.js')
    const { loadAstroTemplate, renderAstroTemplate } = await import('./astro-templates')
    const Code = createComponent((_result: unknown, props: { code: string }) => renderTemplate`<pre>${props.code}</pre>`)
    const template = await loadAstroTemplate('components/CoreHome.astro', { modules: { 'astro-expressive-code/components': { Code } } })
    const window = new Window()
    try {
      window.document.body.innerHTML = await renderAstroTemplate(template, { props: { port: 'erlang', version: 'latest', cards: [] } })
      const text = window.document.body.textContent
      expect(text).toContain('{deps, [{libtmux_erlang, "0.0.1"}]}.')
      expect(text).not.toContain('{:libtmux_erlang')
      expect(text).not.toContain('Pin to a range')
    } finally { await window.happyDOM.abort() }
  })

  it('no longer says the application is unreleased', () => {
    for (const { note } of erlang.installs) expect(note).not.toMatch(/unreleased|no Hex package/i)
    expect(library.note ?? '').not.toMatch(/no Hex release/i)
  })
})
