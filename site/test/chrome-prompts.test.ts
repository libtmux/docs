import { describe, expect, it } from 'vitest'
import { TOPICS } from '../src/lib/prompts'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'
import { parseHtml } from './header-page'

/**
 * A menu holds a label and one short line (design system, AgentPrompt rules,
 * adoption step 26): each task row carries a line of six words or fewer and
 * the full sentence stays as the summary beside the die.
 */
describe('task picker rows', () => {
  it('give every task a menu line of six words or fewer, apart from its sentence', () => {
    for (const topic of TOPICS) {
      const words = topic.menu.trim().split(/\s+/)
      expect(words.length, topic.id).toBeGreaterThan(0)
      expect(words.length, `${topic.id}: ${topic.menu}`).toBeLessThanOrEqual(6)
      expect(topic.menu, topic.id).not.toBe(topic.summary)
      expect(topic.summary.length, topic.id).toBeGreaterThan(topic.menu.length)
      expect(topic.menu, topic.id).not.toMatch(/[.!?]$/)
    }
  })

  it('show the line in the row, keep the sentence for the summary and for matching', async () => {
    const picker = await loadAstroTemplate('components/widgets/TaskPicker.astro')
    const doc = parseHtml(await renderAstroTemplate(picker, { props: { defaultTopic: 'setup' } })).document
    const rows = [...doc.querySelectorAll('a[data-task-option]')]
    expect(rows.length).toBe(TOPICS.length)
    for (const [index, row] of rows.entries()) {
      const topic = TOPICS[index]!
      expect(row.querySelector('small')!.textContent, topic.id).toBe(topic.menu)
      expect(row.getAttribute('data-match'), topic.id).toContain(topic.summary)
      expect(row.textContent, topic.id).not.toContain(topic.summary)
    }
  })
})
