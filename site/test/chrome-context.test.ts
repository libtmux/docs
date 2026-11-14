import { Window, type HTMLButtonElement, type HTMLElement } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initDocumentationNavigation } from '../src/components/docs/documentation-navigation'
import { atLeast, below, BP } from '../src/lib/breakpoints'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'
import { parseHtml } from './header-page'

/**
 * The ContextStrip's phone composition from the design system: below
 * `bp-phone` the version and the translation language fold into one
 * "latest · EN" trigger, and the translation-language picker is named for
 * what it chooses.
 */
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('breakpoints', () => {
  it('carry the design tokens bp-phone, bp-tablet, bp-nav and bp-outline', () => {
    expect(BP).toEqual({ phone: 30, tablet: 48, nav: 64, outline: 80 })
  })

  it('answer "below" a thousandth of a rem under the width that "at least" starts at, so no width matches both', () => {
    expect(below('phone')).toBe('(max-width: 29.999rem)')
    expect(atLeast('phone')).toBe('(min-width: 30rem)')
    expect(atLeast('tablet')).toBe('(min-width: 48rem)')
  })
})

describe('the context trigger below bp-phone', () => {
  async function render() {
    vi.stubEnv('LIBTMUX_DOCS_BASE', '/en/')
    const strip = await loadAstroTemplate('components/docs/DocumentationContext.astro', {
      modules: { '../../lib/documentation-navigation': { getDocumentationSurfaces: async () => [] } },
    })
    return parseHtml(await renderAstroTemplate(strip, {
      url: 'https://libtmux.org/en/go/latest/guides/capturing-output/',
      props: { port: 'go', version: 'latest', locale: 'en', sourcePath: 'go/latest/guides/capturing-output', localeStatuses: { en: 'translated' } },
    })).document
  }

  it('shows "latest · EN" as one trigger that names both and says it changes them', async () => {
    const toggle = (await render()).querySelector<HTMLButtonElement>('[data-context-settings-toggle]')!
    expect(toggle.getAttribute('aria-label')).toBe('Version latest, English. Change')
    const summary = toggle.querySelector('.context-settings-summary')!
    expect(summary.textContent).toBe('latest · EN')
    // The accessible name carries it; the short text is for sighted readers.
    expect(summary.getAttribute('aria-hidden')).toBe('true')
    expect(toggle.hasAttribute('hidden')).toBe(true)
  })

  it('names the translation-language picker for what it chooses', async () => {
    const locale = await loadAstroTemplate('components/LocaleSwitcher.astro')
    const html = await renderAstroTemplate(locale, { props: { locale: 'en', sourcePath: 'go/latest/guides/x', localeStatuses: { en: 'translated', ja: 'placeholder' } } })
    expect(parseHtml(html).document.querySelector('summary')!.getAttribute('aria-label')).toBe('Translation language: English')
  })

  function mount(phone: boolean) {
    const win = new Window({ url: 'https://libtmux.org/en/go/latest/' })
    for (const name of ['window', 'document', 'HTMLElement', 'HTMLDetailsElement', 'Element', 'Node', 'AbortController', 'Event', 'KeyboardEvent']) {
      vi.stubGlobal(name, name === 'window' ? win : name === 'document' ? win.document : win[name as keyof Window])
    }
    const queries: string[] = []
    vi.spyOn(win, 'matchMedia').mockImplementation(((query: string) => {
      queries.push(query)
      return { matches: phone && query === below('phone'), media: query, addEventListener() {}, removeEventListener() {} }
    }) as unknown as typeof win.matchMedia)
    win.document.body.innerHTML = `<div data-documentation-context>
      <div data-context-settings id="documentation-settings"><button type="button" data-context-settings-back hidden>Back</button></div>
      <button type="button" data-context-settings-toggle hidden aria-expanded="false">latest · EN</button>
    </div>`
    initDocumentationNavigation()
    return { win, queries, context: win.document.querySelector<HTMLElement>('[data-documentation-context]')!,
      toggle: win.document.querySelector<HTMLButtonElement>('[data-context-settings-toggle]')!,
      back: win.document.querySelector<HTMLButtonElement>('[data-context-settings-back]')! }
  }

  it('opens the settings view from the trigger below bp-phone, focuses Back, and Escape returns to the trigger', async () => {
    const { win, queries, context, toggle, back } = mount(true)
    expect(queries).toContain(below('phone'))
    expect(toggle.hidden).toBe(false)
    toggle.dispatchEvent(new win.Event('click'))
    expect(context.hasAttribute('data-settings-open')).toBe(true)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(win.document.activeElement).toBe(back)
    context.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(context.hasAttribute('data-settings-open')).toBe(false)
    expect(win.document.activeElement).toBe(toggle)
    await win.happyDOM.abort()
  })

  it('leaves the pickers in place from bp-phone up', async () => {
    const { win, context, toggle } = mount(false)
    toggle.dispatchEvent(new win.Event('click'))
    expect(context.hasAttribute('data-settings-open')).toBe(false)
    await win.happyDOM.abort()
  })
})
