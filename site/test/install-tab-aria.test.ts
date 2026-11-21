import { Window } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

/**
 * The installer's tabs name what they switch, as LanguageTabs does (08 Responsive and accessible):
 * a tab has an id and `aria-controls` its panel, and a panel has an id and `aria-labelledby` its tab.
 */
const windows: Window[] = []
afterEach(async () => {
  for (const window of windows.splice(0)) await window.happyDOM.close()
  vi.unstubAllEnvs()
})

async function render(name: 'PackageInstall' | 'McpInstall', props: Record<string, unknown>) {
  vi.stubEnv('LIBTMUX_DOCS_PORT', '')
  const template = await loadAstroTemplate(`components/widgets/${name}.astro`, {
    real: ['InstallCode', 'InstallCooldown', 'InstallCopy', 'InstallFacts', 'InstallTabRow', 'InstallWhere'].map((part) => `components/widgets/${part}.astro`),
    modules: { '../../lib/api-models': { API_MODELS: {} }, 'astro-expressive-code/components': { Code: () => '' } },
  })
  const window = new Window()
  windows.push(window)
  window.document.body.innerHTML = await renderAstroTemplate(template, { props })
  return window.document
}

const ids = (document: Document, selector: string) => [...document.querySelectorAll(selector)]
const tokens = (value: string | null) => (value ?? '').split(/\s+/).filter(Boolean)

/** Every id is unique, each tab's `aria-controls` names panels that exist, and each panel's `aria-labelledby` names tabs that exist and list it. */
function expectPaired(document: Document, tabs: string, panels: string) {
  const all = [...document.querySelectorAll('[id]')].map((element) => element.id)
  expect(new Set(all).size, 'ids are unique').toBe(all.length)
  const tabList = ids(document, tabs)
  const panelList = ids(document, panels)
  expect(tabList.length).toBeGreaterThan(0)
  expect(panelList.length).toBeGreaterThan(0)
  for (const tab of tabList) {
    expect(tab.id, `${tab.textContent!.trim()} has an id`).toBeTruthy()
    const controlled = tokens(tab.getAttribute('aria-controls'))
    expect(controlled.length, `${tab.id} controls a panel`).toBeGreaterThan(0)
    for (const id of controlled) expect(document.getElementById(id), `${tab.id} controls #${id}`).not.toBeNull()
  }
  for (const panel of panelList) {
    expect(panel.id, 'a panel has an id').toBeTruthy()
    const labels = tokens(panel.getAttribute('aria-labelledby'))
    expect(labels.length, `${panel.id} is named by a tab`).toBeGreaterThan(0)
    for (const id of labels) {
      const tab = document.getElementById(id)
      expect(tab?.getAttribute('role'), `${panel.id} is named by #${id}`).toBe('tab')
      expect(tokens(tab!.getAttribute('aria-controls')), `#${id} controls ${panel.id}`).toContain(panel.id)
    }
  }
}

describe('installer tab roles', () => {
  it('pairs the language tabs with their panels', async () => {
    const document = await render('PackageInstall', { ports: ['py', 'go', 'rs'] })
    expectPaired(document, '.lm-pkg-install__tabs > [role="tab"]', '.lm-pkg-install > .lm-pkg-install__body > [role="tabpanel"]')
  })

  it('names the command each package-manager tab controls', async () => {
    const document = await render('PackageInstall', { ports: ['py'] })
    const managers = ids(document, '.lm-pkg-install__manager[role="tab"]')
    expect(managers.length).toBeGreaterThan(1)
    for (const tab of managers) {
      const [target] = tokens(tab.getAttribute('aria-controls'))
      expect(tab.id).toBeTruthy()
      expect(document.getElementById(target!)?.matches('.lm-pkg-install__cmd'), `${tab.id} controls a command`).toBe(true)
    }
  })

  it('pairs the MCP client, run-with and scope tabs with the panels they switch', async () => {
    const document = await render('McpInstall', { port: 'py' })
    expectPaired(document, '.lm-mcp-install [role="tab"]', '.lm-install__body > [role="tabpanel"]')
    // A panel is named by its client, its way to run and, for a client with scopes, its scope.
    const named = ids(document, '.lm-install__body > [role="tabpanel"][data-client="claude-code"]').map((panel) => tokens(panel.getAttribute('aria-labelledby')).length)
    expect(Math.max(...named)).toBeGreaterThanOrEqual(2)
  })

  it('has a control: a tab whose panel is missing fails the pairing', async () => {
    const document = await render('PackageInstall', { ports: ['py', 'go'] })
    document.querySelector('.lm-pkg-install > .lm-pkg-install__body > [role="tabpanel"]')!.removeAttribute('id')
    expect(() => expectPaired(document, '.lm-pkg-install__tabs > [role="tab"]', '.lm-pkg-install > .lm-pkg-install__body > [role="tabpanel"]')).toThrow()
  })
})
