import { experimental_AstroContainer } from 'astro/container'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { OWNER_KINDS, symbolsForProduct } from '@libtmux/api-model/reference'
import { API_MODELS } from '../src/lib/api-models'
import { PORT_BY_SLUG } from '../src/lib/ports'
import { countsSentence, firstIndexLetter, indexCounts, sourceRevision } from '../src/lib/api-index-head'
import { loadAstroTemplate, withoutScope } from './astro-templates'

const windows: Window[] = []
afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.abort() })

const go = API_MODELS.go

describe('the counts of a reference home', () => {
  it('are computed from the core declarations of the model, not typed', () => {
    const symbols = symbolsForProduct(go, 'core')
    const counts = Object.fromEntries(indexCounts(go).map((entry) => [entry.word, entry.count]))
    expect(counts.types).toBe(symbols.filter((symbol) => OWNER_KINDS.has(symbol.kind) && symbol.kind !== 'module').length)
    expect(counts.methods).toBe(symbols.filter((symbol) => symbol.kind === 'method').length)
    expect(counts.functions).toBe(symbols.filter((symbol) => symbol.kind === 'function').length)
    // Every kind that has no declarations is left out, and a count of one is singular.
    expect(indexCounts({ ...go, symbols: go.symbols.filter((symbol) => symbol.kind === 'function').slice(0, 1) })).toEqual([{ word: 'function', count: 1 }])
    expect(countsSentence([{ word: 'types', count: 1604 }, { word: 'functions', count: 78 }, { word: 'methods', count: 2 }])).toBe('1,604 types, 78 functions and 2 methods')
  })

  it('names the revision once, as repo@sha, and the letter the alphabetical index opens on', () => {
    expect(sourceRevision(go)).toBe(`${go.repo}@${go.revision!.slice(0, 12)}`)
    expect(sourceRevision({ ...go, revision: undefined })).toBeUndefined()
    expect(firstIndexLetter(go)).toMatch(/^[a-z0-9]$/)
  })
})

describe('the head of the reference home', () => {
  async function render(port: string) {
    const template = await loadAstroTemplate('components/api/ApiIndexHead.astro')
    const container = await experimental_AstroContainer.create({ astroConfig: { site: 'https://libtmux.org' } } as never)
    const win = new Window()
    windows.push(win)
    win.document.body.innerHTML = withoutScope(await container.renderToString(template as never, {
      request: new Request('https://libtmux.org/en/go/latest/reference/'), props: { port, base: '/en/go/latest/reference/' },
    }))
    return win.document
  }

  it('shows the counts, the view switch, the ecosystem host as an alternative and the revision', async () => {
    const document = await render('go')
    expect(document.querySelector('.api-index-counts')!.textContent).toBe(`${countsSentence(indexCounts(go))}.`)
    const links = [...document.querySelectorAll('.api-index-view a')]
    expect(links.map((link) => link.textContent)).toEqual(['By area', 'A–Z index'])
    expect(links[0].getAttribute('aria-current')).toBe('page')
    expect(links[1].getAttribute('href')).toBe(`/en/go/latest/reference/symbols/${firstIndexLetter(go)}/`)
    const host = document.querySelector('.api-index-also a')!
    expect(host.getAttribute('href')).toBe(PORT_BY_SLUG.go.ecosystemHost!.url)
    expect(host.textContent).toContain('pkg.go.dev')
    expect(document.querySelector('.api-index-also code')!.textContent).toBe(sourceRevision(go))
  })

  it('has no host link for a port whose reference lives only here', async () => {
    const document = await render('py')
    expect(document.querySelector('.api-index-also a')).toBeNull()
  })
})
