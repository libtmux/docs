import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { Window, type HTMLButtonElement } from 'happy-dom'
import { PORT_BY_SLUG } from '../src/lib/ports'
import { installsFor, installSelection, REGISTRY } from '../src/lib/registry'
import { pickerPaintRules } from '../src/lib/picker-paint'
import csharp from '../src/data/api/csharp.json'
import fsharp from '../src/data/api/fsharp.json'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'
import { runWidgetScript } from './widget-script'

const models = { csharp, fsharp }
const windows: Window[] = []
afterEach(async () => { vi.unstubAllEnvs(); for (const win of windows.splice(0)) await win.happyDOM.abort() })
const forms = (slug: string, env: Record<string, string> = {}) => {
  const port = PORT_BY_SLUG[slug]
  return installsFor(port, installSelection(port, models[slug as keyof typeof models]?.sources, env))
}

describe('NuGet installation recipes', () => {
  it.each(['csharp', 'fsharp'])('offers each applicable method for %s with its own source version', (slug) => {
    const port = PORT_BY_SLUG[slug], commands = forms(slug)
    expect(commands.map((cmd) => cmd.label)).toEqual(['.NET CLI', 'PMC', 'PackageReference', 'CPM', 'Paket CLI', 'Script & Interactive', 'File-Based Apps', 'Cake'])
    const version = models[slug as keyof typeof models].sources.find((source) => source.package === port.packageName)!.version
    expect(commands[2].code).toContain(`Version="${version}"`)
    expect(commands[1].code).toBe(`NuGet\\Install-Package ${port.packageName} -Version ${version}`)
    expect(commands.every((cmd) => cmd.code.includes(port.packageName))).toBe(true)
    expect(JSON.stringify(commands)).not.toMatch(/#tool|LibTmux\.Workspace|LibTmux\.Mcp/)
    expect(commands[7].code).toContain('&loaddependencies=true')
    expect(commands[6].note).toContain('C# file-based apps require the .NET 10 SDK')
    expect(commands[5].note).toContain('F# .fsx')
    expect(commands[3].additionalBlocks?.[0].code).toBe(`<PackageReference Include="${port.packageName}" />`)
    expect(commands[3].code).toContain('<ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>')
    expect(commands[0].code).toBe(slug === 'csharp' ? 'dotnet package add LibTmux' : `dotnet package add LibTmux.FSharp --version ${version}`)
  })

  it.each(['csharp', 'fsharp'])('gives the selected historical %s release priority over the model and registry', (slug) => {
    const commands = forms(slug, { LIBTMUX_DOCS_PORT: slug, LIBTMUX_DOCS_VERSION: 'v0.0.0-alpha.12' })
    expect(commands[0].code).toContain('--version 0.0.0-alpha.12')
    for (const command of commands) expect(command.code).toContain('0.0.0-alpha.12')
    expect(commands[3].additionalBlocks?.[0].code).not.toContain('Version=')
    expect(JSON.stringify(commands.map(({ code, additionalBlocks }) => ({ code, additionalBlocks })))).not.toContain('{version}')
  })

  it('does not borrow a selected C# release for F# or mistake a maintenance branch for a package version', () => {
    for (const env of [{ LIBTMUX_DOCS_PORT: 'csharp', LIBTMUX_DOCS_VERSION: 'v0.0.0-alpha.12' }, { LIBTMUX_DOCS_PORT: 'fsharp', LIBTMUX_DOCS_VERSION: 'v0.x' }]) {
      expect(forms('fsharp', env)[0].code).toEqual(forms('fsharp')[0].code)
    }
  })

  it('fills additional fragments when a recipe needs its version there', () => {
    const port = { ...PORT_BY_SLUG.fsharp, installs: [{ label: 'CPM', target: 'Directory.Packages.props', code: 'main', lang: 'xml', additionalBlocks: [{ code: '{version}', lang: 'xml' }] }] }
    expect(installsFor(port, { version: '1.2.3' })[0].additionalBlocks?.[0].code).toBe('1.2.3')
  })
})

const packageFile = new URL('../src/components/widgets/PackageInstall.astro', import.meta.url)
const copyFile = new URL('../src/components/widgets/InstallCode.astro', import.meta.url)
// The real components, bound to this file's own modules; only collection loading and unused example
// rendering are left out of this focused fixture.
const component = () => loadAstroTemplate('components/widgets/PackageInstall.astro', {
  real: ['InstallCode', 'InstallCooldown', 'InstallFacts', 'InstallTabRow', 'InstallWhere'].map((name) => `components/widgets/${name}.astro`),
  modules: { '../../lib/api-models': { API_MODELS: models }, 'astro-expressive-code/components': { Code: () => '' } },
})
async function render(slug: string, saved?: string, ports = [slug]) {
  const win = new Window({ url: `https://libtmux.org/en/${slug}/latest/` }); windows.push(win)
  if (saved) {
    win.localStorage.setItem(`libtmux-docs.package-install.manager.${slug}`, saved)
    win.document.documentElement.setAttribute(`data-pkg-manager-${slug}`, saved)
  }
  win.document.body.innerHTML = await renderAstroTemplate(await component(), { props: { ports } })
  const style = win.document.createElement('style')
  style.textContent = readFileSync(new URL('../src/components/widgets/package-install.css', import.meta.url), 'utf8') + pickerPaintRules()
  win.document.head.append(style)
  return win
}
function hydrate(win: Window, file: URL) {
  runWidgetScript(win, file)
  win.document.dispatchEvent(new win.Event('astro:page-load'))
}

async function renderPair(slug: string, ports = [slug]) {
  const win = await render(slug, '3', ports)
  win.document.body.append(win.document.querySelector('.lm-pkg-install')!.cloneNode(true))
  hydrate(win, packageFile)
  return win
}

function pressKey(win: Window, tab: HTMLButtonElement, key: string) {
  tab.focus()
  const event = new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  tab.dispatchEvent(event)
  return event
}

function expectSelected(tabs: HTMLButtonElement[], index: number) {
  expect(tabs.map((tab) => [tab.getAttribute('aria-selected'), tab.tabIndex])).toEqual(
    tabs.map((_, position) => [String(position === index), position === index ? 0 : -1]),
  )
}

function tabGroups(win: Window, strip: 'manager' | 'language') {
  const selector = strip === 'manager'
    ? '.lm-pkg-install__panel[data-port="csharp"] .lm-pkg-install__manager'
    : '.lm-pkg-install__tabs > .lm-pkg-install__tab'
  return [...win.document.querySelectorAll('.lm-pkg-install')]
    .map((widget) => [...widget.querySelectorAll<HTMLButtonElement>(selector)])
}

function savedState(win: Window) {
  return Array.from({ length: win.localStorage.length }, (_, index) => {
    const key = win.localStorage.key(index)!
    return [key, win.localStorage.getItem(key)]
  })
}

describe('package tab keyboard navigation', () => {
  it.each([
    ['csharp', 'Home', 0], ['csharp', 'End', 7],
    ['fsharp', 'Home', 0], ['fsharp', 'End', 7],
  ] as const)('selects and remembers the %s manager edge with %s', async (slug, key, index) => {
    const win = await renderPair(slug), doc = win.document
    const panels = [...doc.querySelectorAll('.lm-pkg-install__panel')]
    const groups = panels.map((panel) => [...panel.querySelectorAll<HTMLButtonElement>('.lm-pkg-install__manager')])
    let changes = 0
    win.addEventListener('lm-pkg-install:manager', () => changes++)
    const event = pressKey(win, groups[0][3], key)
    expect(doc.activeElement?.getAttribute('data-manager-value')).toBe(String(index))
    expect(event.defaultPrevented).toBe(true)
    expect(doc.activeElement).toBe(groups[0][index])
    for (const [position, tabs] of groups.entries()) {
      expectSelected(tabs, index)
      expect(panels[position].getAttribute('data-active-manager')).toBe(String(index))
    }
    expect(doc.documentElement.getAttribute(`data-pkg-manager-${slug}`)).toBe(String(index))
    expect(win.localStorage.getItem(`libtmux-docs.package-install.manager.${slug}`)).toBe(String(index))
    expect(changes).toBe(1)
  })

  it.each(['Home', 'End'])('selects and remembers the language edge with %s', async (key) => {
    const win = await renderPair('csharp', ['csharp', 'fsharp']), doc = win.document
    const groups = tabGroups(win, 'language'), index = key === 'Home' ? 0 : groups[0].length - 1
    const start = key === 'Home' ? groups[0].at(-1)! : groups[0][0]
    start.click()
    let changes = 0
    win.addEventListener('lm-pkg-install:change', () => changes++)
    const event = pressKey(win, start, key), slug = groups[0][index].dataset.tabValue!
    expect(doc.activeElement?.getAttribute('data-tab-value')).toBe(slug)
    expect(event.defaultPrevented).toBe(true)
    expect(doc.activeElement).toBe(groups[0][index])
    for (const tabs of groups) expectSelected(tabs, index)
    expect([...doc.querySelectorAll('.lm-pkg-install')].map((widget) => widget.getAttribute('data-active-port'))).toEqual([slug, slug])
    expect(doc.documentElement.getAttribute('data-pkg-port')).toBe(slug)
    expect(win.localStorage.getItem('libtmux-docs.package-install.port')).toBe(slug)
    expect(changes).toBe(1)
  })

  it.each(['manager', 'language'] as const)('preserves wrapping arrow navigation in the %s strip', async (strip) => {
    const win = await renderPair('csharp', ['csharp', 'fsharp']), groups = tabGroups(win, strip)
    const last = groups[0].length - 1
    groups[0][last].click()
    for (const [key, index] of [['ArrowRight', 0], ['ArrowLeft', last]] as const) {
      const current = groups[0].find((tab) => tab.getAttribute('aria-selected') === 'true')!
      expect(pressKey(win, current, key).defaultPrevented).toBe(true)
      expect(win.document.activeElement).toBe(groups[0][index])
      for (const tabs of groups) expectSelected(tabs, index)
    }
  })

  it.each(['manager', 'language'] as const)('leaves other keys to the %s strip', async (strip) => {
    const win = await renderPair('csharp', ['csharp', 'fsharp']), groups = tabGroups(win, strip)
    const index = strip === 'manager' ? 3 : 1, current = groups[0][index]
    current.click()
    const before = savedState(win)
    let changes = 0
    win.addEventListener('lm-pkg-install:manager', () => changes++)
    win.addEventListener('lm-pkg-install:change', () => changes++)
    for (const key of ['Tab', 'Enter', ' ', 'ArrowUp', 'ArrowDown', 'x']) {
      expect(pressKey(win, current, key).defaultPrevented).toBe(false)
      expect(win.document.activeElement).toBe(current)
      for (const tabs of groups) expectSelected(tabs, index)
      expect(savedState(win)).toEqual(before)
    }
    expect(changes).toBe(0)
  })

  it.each(['manager', 'language'] as const)('keeps a single remaining %s tab unchanged', async (strip) => {
    const win = await renderPair('csharp', ['csharp', 'fsharp']), groups = tabGroups(win, strip)
    const current = groups[0][0]
    current.click()
    for (const tab of groups[0].slice(1)) tab.remove()
    const before = savedState(win)
    let changes = 0
    win.addEventListener('lm-pkg-install:manager', () => changes++)
    win.addEventListener('lm-pkg-install:change', () => changes++)
    for (const key of ['Home', 'End', 'ArrowLeft', 'ArrowRight']) {
      expect(pressKey(win, current, key).defaultPrevented).toBe(false)
      expect(win.document.activeElement).toBe(current)
      expectSelected([current], 0)
      expectSelected(groups[1], 0)
      expect(savedState(win)).toEqual(before)
    }
    expect(changes).toBe(0)
  })

  it('omits tab strips when the rendered port has one install choice', async () => {
    const win = await render('rs')
    expect(win.document.querySelectorAll('[role="tab"]')).toHaveLength(0)
    expect(win.document.querySelectorAll('.lm-install__body .lm-pkg-install__cmd')).toHaveLength(1)
  })
})

describe('NuGet widget rendering and copied fragments', () => {
  it.each(['csharp', 'fsharp'])('paints the saved CPM choice and copies each %s fragment separately', async (slug) => {
    const win = await render(slug, '3'), doc = win.document
    // The surface draws each choice in its header (where the code goes and Copy), its body and, where it has one, its note.
    const panels = [...doc.querySelectorAll('.lm-install__body .lm-pkg-install__cmd')]
    const shown = (cmd: Parameters<typeof win.getComputedStyle>[0]) => win.getComputedStyle(cmd).display !== 'none'
    expect([...doc.querySelectorAll('.lm-pkg-install__cmd')].filter(shown).map((panel) => panel.getAttribute('data-manager'))).toEqual(['3', '3', '3'])
    expect(panels.filter(shown).map((panel) => panel.getAttribute('data-manager'))).toEqual(['3'])
    const cpm = panels[3], blocks = [...cpm.querySelectorAll('[data-install-code]')]
    expect(blocks).toHaveLength(2)
    expect(cpm.querySelectorAll('code span[style]').length).toBeGreaterThan(5)
    // The main fragment is copied from the header, the other from the strip that carries it.
    const header = doc.querySelector('.lm-install__headend .lm-pkg-install__cmd[data-manager="3"] [data-action="copy"]')!
    const strip = blocks[1].querySelector('button')!
    expect(header.getAttribute('aria-label')).toBe('Copy Directory.Packages.props')
    expect(strip.getAttribute('aria-label')).toBe('Copy Project file (.csproj or .fsproj)')
    expect(blocks[0].querySelector('button')).toBeNull()
    const copied: string[] = []
    Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: async (text: string) => { copied.push(text) } } })
    hydrate(win, packageFile); hydrate(win, copyFile)
    for (const button of [header, strip]) (button as HTMLButtonElement).click()
    await Promise.resolve()
    expect(copied).toEqual([forms(slug)[3].code, forms(slug)[3].additionalBlocks![0].code])
    expect(copied[0]).not.toContain('$ ')
    const active = doc.querySelector('.lm-pkg-install__manager[aria-selected="true"]')!
    expect(active.getAttribute('data-manager-value')).toBe('3')
    active.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(doc.querySelector('.lm-pkg-install__manager[aria-selected="true"]')?.getAttribute('data-manager-value')).toBe('4')
    expect(doc.activeElement?.getAttribute('data-manager-value')).toBe('4')
  })

  it.each(['csharp', 'fsharp'])('copies every %s method without prompts or sibling fragments', async (slug) => {
    const win = await render(slug), copied: string[] = []
    Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: async (text: string) => { copied.push(text) } } })
    hydrate(win, packageFile); hydrate(win, copyFile)
    const commands = forms(slug)
    for (const [index, command] of commands.entries()) {
      win.document.querySelector<HTMLButtonElement>(`.lm-pkg-install__manager[data-manager-value="${index}"]`)!.click()
      const panel = win.document.querySelector(`.lm-install__body .lm-pkg-install__cmd[data-manager="${index}"]`)!
      expect(win.getComputedStyle(panel).display).toBe('block')
      const header = win.document.querySelector<HTMLButtonElement>(`.lm-install__headend .lm-pkg-install__cmd[data-manager="${index}"] button[data-action="copy"]`)!
      for (const button of [header, ...panel.querySelectorAll<HTMLButtonElement>('button[data-action="copy"]')]) button.click()
      await Promise.resolve()
      expect(copied.splice(0)).toEqual([command.code, ...(command.additionalBlocks ?? []).map((block) => block.code)])
    }
  })

  it('keeps the no-script default visible and highlights C# directives at render time', async () => {
    const win = await render('csharp')
    expect([...win.document.querySelectorAll('.lm-install__body .lm-pkg-install__cmd')].filter((panel) => win.getComputedStyle(panel).display !== 'none')).toHaveLength(1)
    expect(win.document.querySelector('.lm-install__body [data-manager="6"] code span[style]')).not.toBeNull()
  })

  it('does not hide Source fallback when storage remembers an unavailable manager', async () => {
    const originalEntry = REGISTRY.ports.fsharp, originalSources = fsharp.sources
    try {
      REGISTRY.ports.fsharp = { status: 'unpublished', version: null, release: null, tag: 'v0.0.0-alpha.18' }
      fsharp.sources = []
      const win = await render('fsharp', '3')
      const source = win.document.querySelector('.lm-install__body .lm-pkg-install__cmd')!
      expect(source.textContent).toContain('dotnet add reference')
      expect(win.getComputedStyle(source).display).toBe('block')
      hydrate(win, packageFile)
      expect(win.getComputedStyle(source).display).toBe('block')
    } finally { REGISTRY.ports.fsharp = originalEntry; fsharp.sources = originalSources }
  })
})
