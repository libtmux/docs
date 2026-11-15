import { Window } from 'happy-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { buildPanels, SERVERS } from '../src/lib/install-matrix'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

/**
 * The installer's one code surface: what its data carries and what it draws.
 *
 * The surface draws the prompt (`$`, `PS>`, `PM>`), so the data carries none;
 * it marks the path a reader replaces; and it names where the code goes.
 */
const windows: Window[] = []
const openWindow = (): Window => {
  const window = new Window()
  windows.push(window)
  return window
}
afterEach(async () => { for (const window of windows.splice(0)) await window.happyDOM.close() })

describe('MCP install data', () => {
  it('carries no prompt on a shell command, since the surface draws it', () => {
    const consoles = Object.values(SERVERS).flatMap((spec) => buildPanels(spec, 'a'.repeat(40)).filter((panel) => panel.language === 'console'))
    expect(consoles.length).toBeGreaterThan(100)
    expect(consoles.filter((panel) => /^\$ /m.test(panel.body)).map((panel) => `${panel.client.id}/${panel.method.id}`)).toEqual([])
  })

  it('draws the prompt once, and copies the command without it', async () => {
    const picker = await loadAstroTemplate('components/widgets/McpInstall.astro', {
      modules: { '../../lib/highlight': { highlightWithCooldownSlots: async (code: string) => code } },
    })
    const window = openWindow()
    const document = window.document as unknown as Document
    document.body.innerHTML = await renderAstroTemplate(picker, { props: { port: 'py' } })
    const shown = document.querySelector('.lm-mcp-install__panel[data-default] .lm-mcp-install__code[data-language="console"] code')?.textContent
    expect(shown).toMatch(/^\$ claude mcp add tmux/)
    expect(shown).not.toMatch(/\$ \$/)
  })
})
