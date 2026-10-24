import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { experimental_AstroContainer } from 'astro/container'
import { Window, type Document } from 'happy-dom'
import { membersOf, memberSignals, moduleOf, qualifiedNameOf, type ApiSymbol } from '@libtmux/api-model'
import mentionsData from '../src/data/mentions.json'
import { API_MODELS, indexFor, pageSlug, topLevelTypesOf } from '../src/lib/api-models'
import { ownerQualifiedName, relatedLabels, type RelatedLabelInput } from '../src/lib/api-labels'
import { relatedApiTypes, relatedTypeLinks, type RelatedTypeLink } from '../src/lib/api-sections'
import { coreApiSymbols } from '../src/lib/product-api'
import { wordBreak } from '../src/lib/word-break'
import { tmuxReferenceContext, tmuxReferenceIndex, tmuxReferenceUrl, tmuxSourceModel } from '../src/lib/tmux-reference'
import { loadAstroTemplate, withoutScope } from './astro-templates'

vi.mock('astro:content', () => ({ getCollection: async () => [] }))

/**
 * A related type is labelled so that a reader can tell which entity it is. A bare name stays when it is unambiguous and the page's
 * own subject owns it; an Elixir type, whose `t/0` means nothing outside its module, and any name more than one type in the port carries
 * take their owner when another declaration owns them; entries that would still read alike take their owner, then their full name.
 */

const entry = (id: string, over: Partial<RelatedLabelInput> = {}): RelatedLabelInput => {
  const name = id.split(/[.:]+/).at(-1)!
  const owner = id.slice(0, id.length - name.length).replace(/[.:]+$/, '')
  return { id, name, label: name, qualifiedName: id, shared: false, owner: owner ? { id: owner, name: owner.split(/[.:]+/).at(-1)! } : undefined, ...over }
}
const duplicates = (labels: readonly string[]) => [...new Set(labels.filter((label, i) => labels.indexOf(label) !== i))]

describe('the label rule', () => {
  // The reported page: LibTmux.Server lists four types, three of them called t/0.
  const server = ['LibTmux.Snapshot.t/0', 'LibTmux.Error.t/0', 'LibTmux.Transport.OneShot.result/0', 'LibTmux.Server.t/0'].map((id) => entry(id))

  it('names the owner of an Elixir type that another module owns, and leaves the page subject\'s own type bare', () => {
    expect(relatedLabels(server, new Set(['LibTmux.Server']), 'elixir')).toEqual(['Snapshot.t/0', 'Error.t/0', 'OneShot.result/0', 't/0'])
  })

  it('names the owner of the same types on a page that is not their owner\'s', () => {
    expect(relatedLabels(server, new Set(['LibTmux.Pane']), 'elixir')).toEqual(['Snapshot.t/0', 'Error.t/0', 'OneShot.result/0', 'Server.t/0'])
  })

  it('reads a member page\'s own module as home: the page and the module that declares it', () => {
    expect(relatedLabels(server, new Set(['LibTmux.Server.new_session/2', 'LibTmux.Server']), 'elixir')[3]).toBe('t/0')
    expect(relatedLabels(server, new Set(['LibTmux.Snapshot.t/0', 'LibTmux.Snapshot']), 'elixir')).toEqual(['t/0', 'Error.t/0', 'OneShot.result/0', 'Server.t/0'])
  })

  it('names the owner of an Elixir type even when no other type shares its name', () => {
    const [only] = [entry('LibTmux.Schema.observation/0')]
    expect(relatedLabels([only!], new Set(['LibTmux.Filter']), 'elixir')).toEqual(['Schema.observation/0'])
  })

  it('leaves another port\'s names alone when nothing makes them ambiguous', () => {
    // A nested name only one type carries, a top-level name and a top-level name that repeats: none of them is touched.
    const unique = [entry('swift.RegexPattern.Options'), entry('Server'), entry('libtmux.Server', { label: 'Server (libtmux)', owner: undefined })]
    expect(relatedLabels(unique, new Set(['Client']), 'swift')).toEqual(['Options', 'Server', 'Server (libtmux)'])
  })

  it('separates colliding names in any language and leaves the unambiguous one in the same list alone', () => {
    expect(relatedLabels(server, new Set(['LibTmux.Pane']), 'ruby')).toEqual(['Snapshot.t/0', 'Error.t/0', 'result/0', 'Server.t/0'])
  })

  it('names the owner of a nested name that more than one type in the port carries, when the page does not own it', () => {
    const builder = entry('io.github.libtmux.CaptureSpec.Builder', { shared: true })
    expect(relatedLabels([builder], new Set(['io.github.libtmux.FilterSpec']), 'java')).toEqual(['CaptureSpec.Builder'])
    expect(relatedLabels([builder], new Set(['io.github.libtmux.CaptureSpec']), 'java')).toEqual(['Builder'])
    expect(relatedLabels([builder], new Set(['io.github.libtmux.CaptureSpec.Builder.from', 'io.github.libtmux.CaptureSpec.Builder']), 'java')).toEqual(['Builder'])
    const async = entry('LibTmux::Async::Server', { shared: true })
    expect(relatedLabels([async], new Set(['LibTmux::Async::Scope#server', 'LibTmux::Async::Scope']), 'ruby')).toEqual(['Async::Server'])
  })

  it('names the owner of whichever entries still read alike, and spells the last collision in full', () => {
    const pair = [entry('LibTmux::Async::Server', { label: 'Server' }), entry('LibTmux::Server', { label: 'Server', owner: undefined })]
    expect(duplicates(pair.map((item) => item.label))).toEqual(['Server'])
    expect(relatedLabels(pair, new Set(['LibTmux::Async::Server']), 'ruby')).toEqual(['Async::Server', 'LibTmux::Server'])
    const twins = [entry('A.Request.t/0'), entry('B.Request.t/0')]
    expect(relatedLabels(twins, new Set(['C']), 'elixir')).toEqual(['A.Request.t/0', 'B.Request.t/0'])
  })

  it('spells the owner with the separator the language\'s own qualified name uses', () => {
    expect(ownerQualifiedName(entry('LibTmux.Snapshot.t/0'))).toBe('Snapshot.t/0')
    expect(ownerQualifiedName(entry('libtmux::FilterExpr::Node'))).toBe('FilterExpr::Node')
    expect(ownerQualifiedName(entry('LibTmux::Async::Server'))).toBe('Async::Server')
    expect(ownerQualifiedName(entry('Server', { owner: undefined }))).toBe('Server')
    expect(ownerQualifiedName(entry('x.Y.z', { owner: { id: 'x.Q', name: 'Q' } }))).toBe('x.Y.z')
  })
})

const TYPES = ['class', 'struct', 'union', 'interface', 'trait', 'enum', 'typealias']

/** `before` is each entry's label without the owner rule: its name, with the module of a top-level type whose name repeats. */
interface Page { port: string; owner: ApiSymbol; links: RelatedTypeLink[]; before: string[] }

let built: Page[] | undefined

/** Every page of every port, with the related list the page builds. */
function pages(): Page[] {
  if (built) return built
  const all: Page[] = []
  for (const [port, model] of Object.entries(API_MODELS)) {
    const hrefFor = (symbol: ApiSymbol) => `/${port}/${symbol.slug ?? pageSlug(symbol.publicId ?? symbol.id)}/`
    const index = indexFor(model, hrefFor)
    const signals = memberSignals(port, mentionsData.mentions)
    const repeated = new Map<string, number>()
    for (const type of topLevelTypesOf(model)) repeated.set(type.name, (repeated.get(type.name) ?? 0) + 1)
    const byId = new Map(model.symbols.map((symbol) => [symbol.id, symbol]))
    for (const owner of coreApiSymbols(model)) {
      const members = membersOf(model, owner, signals)
      const links = relatedTypeLinks(model, owner, members, index, hrefFor, { language: port, repeated })
      const before = relatedApiTypes(owner, members, index, owner.parent ? byId.get(owner.parent) : undefined)
        .map((symbol) => (repeated.get(symbol.name) ?? 0) > 1 ? `${symbol.name} (${moduleOf(symbol)})` : symbol.name)
      all.push({ port, owner, links, before })
    }
  }
  return (built = all)
}

describe('related types on the committed models', () => {
  let all: Page[] = []
  beforeAll(() => { all = pages() }, 120_000)
  const page = (port: string, id: string) => {
    const found = all.find((entry) => entry.port === port && (entry.owner.publicId ?? entry.owner.id) === id)
    if (!found) throw new Error(`no ${port} page for ${id}`)
    return found
  }
  const labels = (entry: Page) => entry.links.map((link) => link.name)

  it('lists the reported Elixir page by owner and links each to its own page', () => {
    const server = page('elixir', 'LibTmux.Server')
    expect(server.before).toEqual(['t/0', 't/0', 'result/0', 't/0'])
    expect(labels(server)).toEqual(['Snapshot.t/0', 'Error.t/0', 'OneShot.result/0', 't/0'])
    expect(server.links.map((link) => link.identity)).toEqual(['LibTmux.Snapshot.t/0', 'LibTmux.Error.t/0', 'LibTmux.Transport.OneShot.result/0', 'LibTmux.Server.t/0'])
    expect(server.links.map((link) => link.href)).toEqual(['/elixir/libtmux-snapshot-t-0/', '/elixir/libtmux-error-t-0/', '/elixir/libtmux-transport-oneshot-result-0/', '/elixir/libtmux-server-t-0/'])
    expect(server.links.map((link) => link.kind)).toEqual(Array(4).fill('typealias'))
    expect(server.links.map((link) => link.qualified)).toEqual([true, true, true, false])
  })

  it('names the owner in an Elixir list for every type another module owns, and for no other', () => {
    for (const { owner, links } of all.filter((entry) => entry.port === 'elixir')) {
      for (const link of links.filter((item) => item.symbol.parent)) {
        const home = link.symbol.parent === owner.id || link.symbol.parent === owner.parent || link.symbol.id === owner.parent
        expect(link.name === link.symbol.name, `${qualifiedNameOf(owner)}: ${link.identity} reads as ${link.name}`).toBe(home)
      }
    }
  })

  it('shows no two entries of one related list with the same label, on any port', () => {
    const alike = all.flatMap(({ port, owner, links }) => duplicates(links.map((link) => link.name)).map((label) => `${port} ${qualifiedNameOf(owner)}: ${label}`))
    expect(alike).toEqual([])
  })

  it('shows no two entries alike on the tmux C source reference either, and renames none', () => {
    const version = '3.7c'
    const model = tmuxSourceModel(version)
    const index = tmuxReferenceIndex(version)
    const signals = memberSignals('', [])
    const byId = new Map(model.symbols.map((symbol) => [symbol.id, symbol]))
    const repeated = new Map<string, number>()
    for (const symbol of model.symbols) if (!symbol.parent) repeated.set(symbol.name, (repeated.get(symbol.name) ?? 0) + 1)
    const renamed: string[] = []
    for (const owner of model.symbols) {
      const members = membersOf(model, owner, signals)
      const links = relatedTypeLinks(model, owner, members, index, (symbol) => tmuxReferenceUrl(version, symbol), { language: model.language, repeated, includeInternal: true })
      const before = relatedApiTypes(owner, members, index, owner.parent ? byId.get(owner.parent) : undefined, { includeInternal: true })
        .map((symbol) => (repeated.get(symbol.name) ?? 0) > 1 ? `${symbol.name} (${moduleOf(symbol)})` : symbol.name)
      if (links.some((link, i) => link.name !== before[i]) || duplicates(links.map((link) => link.name)).length > 0) renamed.push(owner.id)
    }
    expect(renamed).toEqual([])
  }, 120_000)

  it('can fail: without the rule some list repeats a label, and with it none does', () => {
    expect(all.filter((entry) => duplicates(entry.before).length > 0).length).toBeGreaterThan(0)
    expect(all.filter((entry) => duplicates(labels(entry)).length > 0)).toEqual([])
  })

  it('marks as qualified exactly the labels the rule changed', () => {
    const wrong = all.flatMap(({ port, owner, links, before }) => links.flatMap((link, i) =>
      link.qualified === (link.name !== before[i]) ? [] : [`${port} ${qualifiedNameOf(owner)}: ${link.identity} reads as ${link.name}, was ${before[i]}, qualified is ${link.qualified}`]))
    expect(wrong).toEqual([])
  })

  it('changes a label outside Elixir only for a name more than one type carries or for entries that would read alike', () => {
    const carried = new Map(Object.entries(API_MODELS).map(([port, model]) => {
      const count = new Map<string, number>()
      for (const symbol of model.symbols) if (TYPES.includes(symbol.kind)) count.set(symbol.name, (count.get(symbol.name) ?? 0) + 1)
      return [port, count] as const
    }))
    for (const { port, owner, links, before } of all.filter((entry) => entry.port !== 'elixir')) {
      for (const [i, link] of links.entries()) {
        if (!link.qualified) continue
        const reason = (carried.get(port)!.get(link.symbol.name) ?? 0) > 1 || before.filter((label) => label === before[i]).length > 1
        expect(reason, `${port} ${qualifiedNameOf(owner)}: ${link.identity} reads as ${link.name}`).toBe(true)
      }
    }
  })

  it('leaves every label of a port with no nested type as its name, or its name and module', () => {
    for (const [port, model] of Object.entries(API_MODELS)) {
      if (model.symbols.some((symbol) => TYPES.includes(symbol.kind) && symbol.parent)) continue
      for (const { owner, links } of all.filter((entry) => entry.port === port)) {
        for (const link of links) {
          expect([link.symbol.name, `${link.symbol.name} (${moduleOf(link.symbol)})`], `${port} ${qualifiedNameOf(owner)}`).toContain(link.name)
        }
      }
    }
  })

  it('keeps Java\'s Builder bare on its own class and Ruby\'s two Servers apart', () => {
    expect(labels(page('java', 'io.github.libtmux.CaptureSpec.CaptureSpec'))).toEqual(['Builder'])
    expect(labels(page('java', 'io.github.libtmux.CaptureSpec.CaptureSpec.Builder.build'))).toEqual(['Builder', 'CaptureSpec'])
    expect(labels(page('ruby', 'LibTmux::Async::Server.open'))).toEqual(['Async::Server', 'LibTmux::Server'])
    expect(labels(page('ruby', 'LibTmux::Async::Scope#server'))).toEqual(['Scope', 'Async::Server'])
  })
})

describe('the rendered related lists', () => {
  const windows: Window[] = []
  afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.abort() })

  /**
   * A page as its own components draw it. Only what a page shows beside the related section is real, as a harness that
   * renders a reference page lists it: the section is part of `ApiReference`, so no child has to be named for it to appear.
   */
  const PAGE_COMPONENTS = ['components/api/ApiPageContents.astro', 'components/api/ApiBadge.astro', 'components/api/SymbolName.astro', 'components/api/ApiRelationships.astro']

  /** One related list as the reader sees it: the label and title of each link, and the label's markup. */
  function shown(root: Document, selector: string) {
    return [...root.querySelectorAll(selector)].map((link) => {
      const code = link.querySelector('code')!
      return { label: code.textContent, markup: code.innerHTML, title: link.getAttribute('title'), href: link.getAttribute('href'), mark: link.querySelector('.api-nav__kind')?.textContent }
    })
  }

  /** What a chip or card draws for a label: break points where the rule changed it, plain text where it did not. */
  const markup = (label: string, before: string) => (label !== before ? wordBreak(label).join('<wbr>') : label).replaceAll('&', '&amp;')

  it('draws the Related APIs chips of every list with unique labels, titles, links, marks and break points', async () => {
    const rail = await loadAstroTemplate('components/api/ApiPageContents.astro', { real: ['components/api/ApiBadge.astro', 'components/api/SymbolName.astro'] })
    const win = new Window({ url: 'https://libtmux.org/' })
    windows.push(win)
    const container = await experimental_AstroContainer.create()
    let lists = 0
    for (const { port, owner, links, before } of pages().filter((entry) => entry.links.length > 1)) {
      const where = `${port} ${qualifiedNameOf(owner)}`
      win.document.body.innerHTML = withoutScope(await container.renderToString(rail as Parameters<typeof container.renderToString>[0], {
        request: new Request('https://libtmux.org/'), props: { sections: [], related: links },
      }))
      const chips = shown(win.document, 'nav.api-related a')
      expect(chips.map((item) => item.label), where).toEqual(links.map((link) => link.name))
      expect(duplicates(chips.map((item) => item.label!)), where).toEqual([])
      for (const [i, link] of links.entries()) {
        expect(chips[i]!.title, where).toBe(link.identity)
        expect(chips[i]!.href, where).toBe(link.href)
        expect(chips[i]!.mark, where).toBeTruthy()
        expect(chips[i]!.markup, `${where}: ${link.name}`).toBe(markup(link.name, before[i]!))
      }
      lists++
    }
    expect(lists).toBeGreaterThan(1000)
  }, 300_000)

  async function reference(props: Record<string, unknown>, slug: string | undefined, path: string) {
    const template = await loadAstroTemplate('components/api/ApiReference.astro', { real: PAGE_COMPONENTS })
    const container = await experimental_AstroContainer.create({ astroConfig: { site: 'https://libtmux.org' } } as never)
    const win = new Window()
    windows.push(win)
    win.document.body.innerHTML = withoutScope(await container.renderToString(template as never, {
      request: new Request(`https://libtmux.org${path}`), params: slug ? { slug } : undefined, props,
    }))
    return win.document
  }

  it('draws the Related types cards of a page from ApiReference, beside the chips that name the same entries', async () => {
    const all = pages()
    // Every page where the rule changed a label, and the first page of each other port with a list to compare.
    const changed = all.filter((entry) => entry.links.some((link, i) => link.name !== entry.before[i]))
    const others = Object.keys(API_MODELS).flatMap((port) => changed.some((entry) => entry.port === port) ? [] : all.filter((entry) => entry.port === port && entry.links.length > 1).slice(0, 1))
    const template = await loadAstroTemplate('components/api/ApiReference.astro', { real: PAGE_COMPONENTS })
    const container = await experimental_AstroContainer.create({ astroConfig: { site: 'https://libtmux.org' } } as never)
    const win = new Window()
    windows.push(win)
    for (const { port, owner, links, before } of [...changed, ...others]) {
      const where = `${port} ${qualifiedNameOf(owner)}`
      win.document.body.innerHTML = withoutScope(await container.renderToString(template as never, {
        request: new Request(`https://libtmux.org/en/${port}/latest/reference/${owner.slug}/`), params: { slug: owner.slug }, props: { model: API_MODELS[port], owner },
      }))
      const ids = [...win.document.querySelectorAll('h2[id^="api-"]')].map((heading) => heading.id)
      expect(ids, where).toContain('api-related-types')
      const cards = shown(win.document, '.api-related-card > a')
      const chips = shown(win.document, 'nav.api-related a')
      expect(cards.map((item) => item.label), where).toEqual(links.map((link) => link.name))
      expect(chips.map((item) => item.label), where).toEqual(cards.map((item) => item.label))
      expect(duplicates(cards.map((item) => item.label!)), where).toEqual([])
      for (const [i, link] of links.entries()) {
        expect(cards[i]!.title, where).toBe(link.identity)
        expect(cards[i]!.href, where).toMatch(new RegExp(`/${link.symbol.slug}/$`))
        expect(cards[i]!.mark, where).toBeTruthy()
        expect(cards[i]!.markup, `${where}: ${link.name}`).toBe(markup(link.name, before[i]!))
      }
    }
    expect(changed.length).toBeGreaterThan(0)
  }, 300_000)

  describe('on the tmux C source reference', () => {
    // The related types these two pages listed before the owner rule, which no C page takes.
    const expected = {
      cmd_list_panes_exec: ['c:enum:cmd_retval', 'c:struct:cmd', 'c:struct:cmdq_item'],
      cmd_list_panes_window: ['c:struct:cmd', 'c:struct:session', 'c:struct:winlink', 'c:struct:cmdq_item'],
    }

    it.each(Object.entries(expected))('keeps the related types of %s, as a section of the page and in the chips', async (name, related) => {
      const model = tmuxSourceModel('latest')
      const byId = new Map(model.symbols.map((entry) => [entry.id, entry]))
      const symbol = model.symbols.find((entry) => entry.name === name)!
      const document = await reference({ source: tmuxReferenceContext('latest', symbol), owner: symbol, searchable: false }, undefined, '/')
      const ids = [...document.querySelectorAll('h2[id^="api-"]')].map((heading) => heading.id)
      // The section follows the declarations the function references, and a section a later change appends may follow it.
      expect(ids).toContain('api-referenced-declarations')
      expect(ids.indexOf('api-related-types')).toBeGreaterThan(ids.indexOf('api-referenced-declarations'))
      const labels = related.map((id) => byId.get(id)!.name)
      const cards = shown(document, '.api-related-card > a')
      expect(cards.map((item) => item.label)).toEqual(labels)
      expect(shown(document, 'nav.api-related a').map((item) => item.label)).toEqual(labels)
      for (const [i, item] of cards.entries()) {
        expect(item.markup, item.label!).toBe(item.label)
        expect(item.title, item.label!).toBe(item.label)
        expect(item.href, item.label!).toBe(tmuxReferenceUrl('latest', byId.get(related[i]!)!))
        expect(item.mark, item.label!).toBeTruthy()
      }
    }, 120_000)
  })
})
