import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadAstroTemplate, renderAstroTemplate, withoutScope } from './astro-templates'
import { asideClass, asideMarkdown, asideTitle, ASIDE_DEFAULT_VARIANT, ASIDE_VARIANTS } from '../src/lib/aside'

const css = readFileSync(new URL('../src/styles/aside.css', import.meta.url), 'utf8')

let template: Awaited<ReturnType<typeof loadAstroTemplate>>
beforeAll(async () => { template = await loadAstroTemplate('components/Aside.astro') })

async function aside(props: Record<string, unknown> = {}) {
  const window = new Window()
  window.document.body.innerHTML = withoutScope(await renderAstroTemplate(template, { url: 'https://libtmux.org/en/', props, slots: { default: '<p>Text.</p>' } }))
  return window.document.querySelector('aside')!
}

describe('Aside', () => {
  it('is compact by default, with the title in its ink and a 16px inline icon', async () => {
    expect(ASIDE_DEFAULT_VARIANT).toBe('compact')
    const note = await aside({ type: 'caution', title: 'Deprecated' })
    expect(note.className).toBe('lm-aside lm-aside--caution lm-aside--compact lm-aside--ink')
    expect(note.querySelector('.lm-aside__title')?.textContent?.trim()).toBe('Deprecated.')
    expect(note.querySelector('.lm-aside__icon')?.className).toBe('lm-aside__icon lm-aside__icon--inline lm-aside__icon--sm')
  })

  it('keeps the block variants and the hue title by prop', async () => {
    const note = await aside({ variant: 'hybrid', ink: false })
    expect(note.className).toBe('lm-aside lm-aside--note lm-aside--hybrid')
    expect(note.querySelector('.lm-aside__title')?.textContent?.trim()).toBe('Note')
    expect(note.querySelector('.lm-aside__icon')?.className).toContain('lm-aside__icon--solid')
    expect([...ASIDE_VARIANTS].sort()).toEqual(['card', 'classic', 'compact', 'hybrid', 'minimal', 'refined', 'slim'])
  })

  it('ends a run-in lead with a full stop, once', () => {
    expect(asideTitle('compact', 'Kills the server')).toBe('Kills the server.')
    expect(asideTitle('slim', 'Deprecated since 0.2.0:')).toBe('Deprecated since 0.2.0:')
    expect(asideTitle('hybrid', 'Kills the server')).toBe('Kills the server')
    expect(asideClass('tip', 'compact', false)).toBe('lm-aside lm-aside--tip lm-aside--compact')
  })

  it('renders a Markdown aside with the same default', () => {
    expect(asideMarkdown('danger', 'Kills', 'Body.')).toContain('<aside class="lm-aside lm-aside--danger lm-aside--compact lm-aside--ink" role="note">')
  })

  it('reads titles from the ink tokens and body text from the page text colour, with no literal greys', () => {
    for (const type of ['note', 'tip', 'caution', 'danger']) expect(css).toContain(`--aside-${type}-ink`)
    expect(css).toContain('.lm-aside--ink {\n  --lm-aside-title: var(--lm-aside-ink);')
    expect(css).not.toMatch(/#[0-9a-f]{3,6}\b|oklch\(/i)
  })
})
