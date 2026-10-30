import { Window } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { experimental_AstroContainer } from 'astro/container'
import { API_MODELS } from '../src/lib/api-models'
import { loadAstroTemplate, withoutScope } from './astro-templates'

// A reference page asks the content collection for its sidebar; none of these checks reads one.
vi.mock('astro:content', () => ({ getCollection: async () => [] }))

type Port = 'rs' | 'go' | 'csharp'

const windows: Window[] = []
afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.abort() })

describe('a type page with a table of fields', () => {
  // The table, the contents rail and the badges are the page's own; the type and prose cells draw plain text.
  const PAGE = ['components/api/ApiPageContents.astro', 'components/api/ApiBadge.astro', 'components/api/SymbolName.astro', 'components/api/ApiScalarMembers.astro']
  async function page(port: Port, id: string) {
    const template = await loadAstroTemplate('components/api/ApiReference.astro', { real: PAGE })
    const container = await experimental_AstroContainer.create({ astroConfig: { site: 'https://libtmux.org' } } as never)
    const win = new Window()
    windows.push(win)
    const owner = API_MODELS[port].symbols.find((entry) => entry.id === id)!
    win.document.body.innerHTML = withoutScope(await container.renderToString(template as never, {
      request: new Request(`https://libtmux.org/en/${port}/latest/reference/${owner.slug}/`), params: { slug: owner.slug }, props: { model: API_MODELS[port], owner },
    }))
    return win.document
  }
  const contents = (document: Window['document']) => [...document.querySelectorAll('nav[aria-label="On this page"] a')].map((link) => [link.getAttribute('href'), link.textContent])

  it.each([['csharp', 'LibTmux.TmuxCommand', 'Properties'], ['go', 'tmux.SessionFilter', 'Fields']] as const)(
    '%s %s names its table %s in the heading, its permalink, its caption and its contents entry', async (port, id, word) => {
      const document = await page(port, id)
      const heading = document.querySelector('h2#api-fields')!
      expect(heading.firstChild?.textContent).toBe(word)
      expect(heading.querySelector('a.api-heading-link')?.getAttribute('aria-label')).toBe(`Link to ${word}`)
      expect(heading.querySelector('a.api-heading-link')?.getAttribute('href')).toBe('#api-fields')
      expect(document.querySelector('.api-field-table caption')?.textContent).toContain(` ${word.toLowerCase()}`)
      expect(contents(document)).toContainEqual(['#api-fields', word])
      // The rest of the members keep their own heading and id.
      expect(document.querySelector('.api-members > h2#api-members')?.firstChild?.textContent).toBe('Members')
    }, 60_000)

  it('names the one heading of a C# type of only properties Properties, and keeps it the sticky Members bar', async () => {
    const document = await page('csharp', 'LibTmux.ClientAttachment')
    expect(document.querySelector('#api-fields')).toBeNull()
    const heading = document.querySelector('.api-members > h2#api-members')!
    expect(heading.firstChild?.textContent).toBe('Properties')
    expect(heading.querySelector('a.api-heading-link')?.getAttribute('aria-label')).toBe('Link to Properties')
    expect(contents(document)).toContainEqual(['#api-members', 'Properties'])
    expect(document.querySelector('.api-members caption')?.textContent).toContain(' properties')
  }, 60_000)
})
