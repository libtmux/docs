import { describe, expect, it } from 'vitest'
import { portHeaderLinks } from '../src/lib/header-links'
import { INVENTORY } from '../src/lib/port-inventory'
import { PORT_BY_SLUG } from '../src/lib/ports'

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
