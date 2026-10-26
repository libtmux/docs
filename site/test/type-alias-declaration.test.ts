import { describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'
import { SymbolIndex, membersOf, pageMembersOf } from '@libtmux/api-model'
import { API_MODELS } from '../src/lib/api-models'
import { referenceTree } from '../src/lib/api-tree'
import { sidebarCatalog } from '../src/lib/api-sidebar'
import { symbolMarkdown } from '../src/lib/symbol-markdown'
import { loadAstroTemplate, renderAstroTemplate, withoutScope } from './astro-templates'

vi.mock('astro:content', () => ({ getCollection: async () => [] }))

const model = API_MODELS.ts
const hrefFor = (symbol: (typeof model.symbols)[number]) => `/en/ts/latest/reference/${symbol.slug}/`
const index = new SymbolIndex(model.symbols, hrefFor, 'ts')
const symbolOf = (id: string) => model.symbols.find((symbol) => symbol.id === id)!
const options = {
  real: ['components/api/ApiType.astro', 'components/api/SymbolName.astro', 'components/api/ApiBadge.astro'],
  modules: {
    'astro-expressive-code/components': { Code: () => '' },
    '../../lib/page-ports-for': { pagePortsFor: async () => [] },
    '../../lib/sidebar': { pageBreadcrumbs: async () => [] },
  },
}

/** The real `ApiEntry`, as the head of a type's own page draws it. */
async function declaration(id: string) {
  const template = await loadAstroTemplate('components/api/ApiEntry.astro', options)
  const html = withoutScope(await renderAstroTemplate(template, { props: { symbol: symbolOf(id), index, port: 'ts', heading: true } }))
  const window = new Window()
  window.document.body.innerHTML = html
  const signature = window.document.querySelector('.gp-sphinx-api-signature')!
  return {
    text: signature.textContent!.replace(/\s+/g, ' ').trim(),
    links: [...signature.querySelectorAll('a.api-type-link')].map((a) => [a.textContent, a.getAttribute('href')]),
    value: signature.querySelector('.api-alias-value')?.textContent ?? undefined,
  }
}

/** The real `ApiReference` page for one type, with its shell stubbed. */
async function page(id: string) {
  const template = await loadAstroTemplate('components/api/ApiReference.astro', options)
  const window = new Window()
  window.document.body.innerHTML = withoutScope(await renderAstroTemplate(template, { props: { model, owner: symbolOf(id) } }))
  return window.document
}

const OPTION_MEMBERS = ['bufferSize', 'reconnect', 'signal', 'target']

describe('TypeScript type alias declarations', () => {
  it('records what an alias names, for every alias in the model', () => {
    const aliases = model.symbols.filter((symbol) => symbol.kind === 'typealias')
    expect(aliases.length).toBeGreaterThan(0)
    expect(aliases.filter((symbol) => !symbol.type).map((symbol) => symbol.id)).toEqual([])
    expect(symbolOf('types.ConnectOptions').type).toBe('ConnectionOptions')
  })

  it('declares ConnectOptions as the name it aliases and links that name', async () => {
    const shown = await declaration('types.ConnectOptions')
    expect(shown.text).toBe('type types.ConnectOptions = ConnectionOptions')
    expect(shown.links).toEqual([['ConnectionOptions', hrefFor(symbolOf('types.ConnectionOptions'))]])
  })

  it('keeps type parameters and the right-hand side as written', async () => {
    const shown = await declaration('common.TmuxId')
    expect(shown.text).toBe('type common.TmuxId<Kind extends TmuxIdKind> = string & { readonly [tmuxIdBrand]: Kind; }')
    expect(shown.value).toBe('string & {\n  readonly [tmuxIdBrand]: Kind;\n}')
    expect(shown.links).toContainEqual(['TmuxIdKind', hrefFor(symbolOf('common.TmuxIdKind'))])
  })

  it('declares a union without resolving members', async () => {
    const shown = await declaration('types.MenuItem')
    expect(shown.text).toBe('type types.MenuItem = MenuEntry | "separator"')
    expect(shown.links.map(([name]) => name)).toEqual(['MenuEntry'])
    expect(pageMembersOf(model, symbolOf('types.MenuItem'))).toEqual([])
    const document = await page('types.MenuItem')
    expect(document.querySelector('#api-members, #api-inherited')).toBeNull()
  })

  it('declares an object type verbatim without resolving members', async () => {
    const shown = await declaration('engine.DaemonGuard')
    expect(shown.value).toBe('{\n  readonly pid: string;\n  readonly startTime: string;\n}')
    expect(pageMembersOf(model, symbolOf('engine.DaemonGuard'))).toEqual([])
  })

  it('lists the members of the declaration a lone reference names, on their existing pages', async () => {
    const owner = symbolOf('types.ConnectOptions')
    const target = symbolOf('types.ConnectionOptions')
    const members = pageMembersOf(model, owner)
    expect(members.map((member) => member.name)).toEqual(OPTION_MEMBERS)
    expect(members.some((member) => member.inheritedFrom)).toBe(false)
    // The alias owns no member symbol: each row is a target member, so it keeps that member's page.
    expect(model.symbols.filter((symbol) => symbol.parent === owner.id)).toEqual([])
    const document = await page('types.ConnectOptions')
    const heading = document.querySelector('#api-members')!
    expect(heading.textContent!.replace(/\s+/g, ' ')).toMatch(/^Members of ConnectionOptions/)
    expect(heading.querySelector('a')!.getAttribute('href')).toBe('/ts/latest/reference/types-connectionoptions/')
    expect(document.querySelector('#api-inherited')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Reached through|Inherited from/)
    expect(document.querySelector('.api-member-list .api-badge--mod')).toBeNull()
    expect([...document.querySelectorAll('.api-member-list a.api-member-link')].map((a) => [a.textContent, a.getAttribute('href')]))
      .toEqual(OPTION_MEMBERS.map((name) => [name, `/ts/latest/reference/types-connectionoptions-${name.toLowerCase()}/`]))
    for (const name of OPTION_MEMBERS) {
      expect(symbolOf(`types.ConnectionOptions.${name}`).slug).toBe(`types-connectionoptions-${name.toLowerCase()}`)
    }
  })

  it('exports the same declaration, target and members as Markdown', () => {
    const markdown = symbolMarkdown({ model, symbol: symbolOf('types.ConnectOptions'), index, hrefFor })
    expect(markdown).toContain('```ts\ntype ConnectOptions = ConnectionOptions\n```')
    expect(markdown).toContain(`- **Alias of:** [\`ConnectionOptions\`](${hrefFor(symbolOf('types.ConnectionOptions'))})`)
    expect(markdown).toContain(`## Members of [\`ConnectionOptions\`](${hrefFor(symbolOf('types.ConnectionOptions'))})`)
    expect(markdown).not.toMatch(/Inherited members|inherited from/)
    for (const name of OPTION_MEMBERS) {
      expect(markdown).toContain(`[\`${name}\`](${hrefFor(symbolOf(`types.ConnectionOptions.${name}`))}) (property)`)
    }
    const union = symbolMarkdown({ model, symbol: symbolOf('types.MenuItem'), index, hrefFor })
    expect(union).toContain('```ts\ntype MenuItem = MenuEntry | "separator"\n```')
    expect(union).not.toMatch(/Alias of|## Members|## Inherited members/)
  })

  it('keeps navigation, sidebar and search on the members each type declares', () => {
    const tree = referenceTree('ts')
    // The alias is an owner kind, but it owns nothing: the four rows belong to ConnectionOptions alone.
    expect(tree.members['types.ConnectOptions']).toBeUndefined()
    expect(tree.members['types.ConnectionOptions']?.map(([name]) => name).sort()).toEqual(OPTION_MEMBERS)
    const owners = new Map<string, string[]>()
    for (const [owner, rows] of Object.entries(tree.members)) {
      for (const [name, , id] of rows) owners.set(id ?? `${owner}.${name}`, [...(owners.get(id ?? `${owner}.${name}`) ?? []), owner])
    }
    expect([...owners].filter(([, list]) => list.length > 1)).toEqual([])
    const catalog = sidebarCatalog(tree)
    for (const name of OPTION_MEMBERS) {
      expect(catalog.ownerOf(`types.ConnectionOptions.${name}`)?.id).toBe('types.ConnectionOptions')
    }
    expect(catalog.membersOf('types.ConnectOptions')).toEqual([])
  })
})
