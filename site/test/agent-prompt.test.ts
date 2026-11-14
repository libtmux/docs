import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Window } from 'happy-dom'
import { loadAstroTemplate, renderAstroTemplate, withoutScope } from './astro-templates'
import { PORTS } from '../src/lib/ports'
import { TOPICS } from '../src/lib/prompts'

/**
 * The agent prompt widget (`components/widgets/AgentPrompt.astro`) as the prompts pages and the homepage draw it:
 * the language is one picker in the controls row, not a bar of 23 tabs, a task row is a label and a line of six
 * words or fewer, and a page that states the task's summary under its heading does not state it twice.
 */
let template: Awaited<ReturnType<typeof loadAstroTemplate>>
beforeAll(async () => { template = await loadAstroTemplate('components/widgets/AgentPrompt.astro', { real: ['components/widgets/TaskPicker.astro', 'components/RerollButton.astro'] }) })

async function widget(props: Record<string, unknown> = {}) {
  const window = new Window()
  window.document.body.innerHTML = withoutScope(await renderAstroTemplate(template, { props }))
  return window.document
}

describe('the language control', () => {
  it('is a picker in the controls row with a search, one option per language, and no tab bar', async () => {
    const document = await widget()
    expect(document.querySelector('[role="tablist"], .lm-agent-prompt__tab')).toBeNull()
    const controls = document.querySelector('.lm-agent-prompt__controls')!
    expect(controls.firstElementChild!.matches('[data-lang-picker]'), 'first in the row').toBe(true)
    const menu = controls.querySelector('[data-lang-menu]')!
    expect([...menu.querySelectorAll('[data-lang-option]')].map((option) => option.getAttribute('data-lang-option'))).toEqual(PORTS.map((port) => port.slug))
    expect(menu.querySelector('input[type="search"]')).not.toBeNull()
    expect(menu.querySelector('summary')!.getAttribute('aria-label')).toMatch(/^Programming language: /)
    expect(controls.firstElementChild!.getAttribute('aria-label'), 'the control is named for what it chooses').toBe('Programming language')
    expect(menu.querySelector('nav')!.getAttribute('aria-label')).toBe('Programming languages')
    expect(menu.querySelectorAll('[aria-current="true"]')).toHaveLength(1)
  })

  it('names the language alone until script draws the picker, so no control is dead', async () => {
    const document = await widget()
    const picker = document.querySelector<HTMLElement>('[data-lang-picker]')!
    expect(picker.querySelector<HTMLElement>('[data-lang-enhanced]')!.hidden).toBe(true)
    expect(picker.querySelector('[data-lang-static]')!.textContent).toBe(picker.querySelector('[data-lang-current]')!.textContent)
    expect(document.querySelector('.lm-agent-prompt__panel[data-default] [data-prompt-text]')!.textContent, 'the default prompt is complete').toContain('Set up libtmux')
  })

  it('draws the stand-in name at the picker\'s size, so script drawing the picker moves nothing below it', () => {
    const source = readFileSync(new URL('../src/components/widgets/AgentPrompt.astro', import.meta.url), 'utf8')
    const rule = (selector: string) => new RegExp(`${selector.replace(/[.[\]]/g, '\\$&')} \\{([^}]*)\\}`).exec(source)?.[1] ?? ''
    expect(rule('.lm-agent-prompt__lang-static')).toMatch(/width: 11rem;/)
    expect(rule('.lm-agent-prompt__lang-static')).toMatch(/min-height: 2\.25rem;/)
    expect(rule('.lm-agent-prompt__lang-picker')).toMatch(/width: 11rem;/)
    expect(rule('.lm-agent-prompt__lang-picker .doc-picker > summary')).toMatch(/min-height: 2\.25rem;/)
  })

  it('sets the prompt at the code size, 13px at a line height of 1.7', () => {
    const source = readFileSync(new URL('../src/components/widgets/AgentPrompt.astro', import.meta.url), 'utf8')
    expect(/\.lm-agent-prompt__code code \{[^}]*font-size: 0\.8125rem;[^}]*line-height: 1\.7;/.test(source)).toBe(true)
    // Control: the published 14px rule is the one this check refuses.
    expect(/\.lm-agent-prompt__code code \{[^}]*font-size: 0\.8125rem;/.test('.lm-agent-prompt__code code { font-size: 0.875rem; line-height: 1.7; }')).toBe(false)
  })

  it('is left out where the page supplies a language picker of its own', async () => {
    const document = await widget({ showLanguageTabs: false })
    expect(document.querySelector('[data-lang-picker], [data-lang-menu]')).toBeNull()
  })
})

describe('the task rows and the summary', () => {
  it('gives each task row a line of six words or fewer, and still finds a task by its full sentence', async () => {
    const document = await widget({ showTaskReset: true, showLanguageTabs: false })
    const rows = [...document.querySelectorAll<HTMLElement>('[data-task-option]')]
    expect(rows).toHaveLength(TOPICS.length)
    for (const [index, row] of rows.entries()) {
      const topic = TOPICS[index]!
      expect(row.querySelector('small')!.textContent, topic.id).toBe(topic.menu)
      expect(row.dataset.match, 'search matches the label, the line and the sentence').toBe(`${topic.label} ${topic.menu} ${topic.summary}`)
    }
  })

  it('states the task\'s summary beside the controls unless the page already says it under its heading', async () => {
    expect((await widget()).querySelector<HTMLElement>('[data-summary]')!.hidden).toBe(false)
    expect((await widget({ showSummary: false })).querySelector<HTMLElement>('[data-summary]')!.hidden).toBe(true)
  })
})
