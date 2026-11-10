import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { createComponent, renderTemplate } from 'astro/runtime/server/index.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EXAMPLES, mcpShowcase } from '../src/lib/mcp-showcase'
import { citedTest, landingExample, offersPicker, presetOptions, revisionUrl, supportedPorts, TOPICS, VIA, workspaceShowcase } from '../src/lib/workspace-showcase'
import { loadCommand } from '../src/lib/workspace-links'
import { STORAGE_PREFIX } from '../src/lib/workspace-picker'
import { landingExcerpt, landingProducts, type CachedSource, type LandingExcerpt, type LandingTable } from '../src/lib/port-landing'
import { PORTS, PORT_BY_SLUG, type DocProduct } from '../src/lib/ports'
import LANDING from '../src/data/landing-examples.json'
import SOURCES from '../src/data/example-sources.json'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

/** The picker's client code as the browser runs it: types erased, exports made local and imports dropped. */
const PICKER_CLIENT = ['home-hover-preview.ts', 'status-toggletip.ts', 'workspace-picker.ts']
  .map((name) => readFileSync(new URL(`../src/lib/${name}`, import.meta.url), 'utf8').replace(/^import .*$/gm, ''))
  .map((code) => transpileModule(code, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 } }).outputText)
  .join('\n').replace(/^export /gm, '')

const table = LANDING as LandingTable
const cache = SOURCES as Record<string, CachedSource>

// The page brings its own copy of the code-block component; this stands in with a marked element.
const Code = createComponent((_result: unknown, props: { code: string; lang: string; title?: string }) =>
  renderTemplate`<pre data-lang="${props.lang}" data-title="${props.title ?? ''}">${props.code}</pre>`)
const REAL = [
  'components/landing/LandingInstall.astro', 'components/mcp/McpReplay.astro',
  'components/replay/TmuxScreen.astro', 'components/replay/ReplayControls.astro',
  'components/workspace/WorkspaceConfig.astro', 'components/workspace/WorkspaceWindows.astro',
  'components/workspace/WorkspaceEvidence.astro', 'components/workspace/WorkspacePicker.astro',
  'components/RerollButton.astro', 'components/docs/PickerSearch.astro',
]
const stubs = {
  'components/HomeExample.astro': '---\nconst { port, language } = Astro.props\n---\n<div data-home-example={port} data-language={language} />',
  'components/CoreShowcase.astro': '---\nconst { port, links } = Astro.props\n---\n<div data-core-showcase={port} data-links={links.length} data-link-targets={JSON.stringify(links)} />',
  'components/widgets/PackageInstall.astro': '---\nconst { ports, packageId = "core" } = Astro.props\n---\n<div data-package-install={ports.join()} data-package-id={packageId} />',
  'components/widgets/McpInstall.astro': '---\nconst { port } = Astro.props\n---\n<div data-mcp-install={port} />',
}

async function renderHtml(slug: string, modules: Record<string, Record<string, unknown>> = {}) {
  const template = await loadAstroTemplate('components/PortLanding.astro', {
    real: REAL,
    stubs,
    modules: { 'astro-expressive-code/components': { Code }, ...modules },
  })
  return renderAstroTemplate(template, { props: { port: PORT_BY_SLUG[slug], version: 'latest' } })
}

// Each page is parsed into a window of its own; a landing page with a 22-preset picker is large,
// so a window stays open only until its test ends.
const opened: Window[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((window) => window.happyDOM.close()))
})

async function render(slug: string) {
  const window = new Window()
  opened.push(window)
  window.document.body.innerHTML = await renderHtml(slug)
  return window.document as unknown as Document
}

describe('the landing page markup', () => {
  it('offers Core API, MCP and Workspace Manager as a selector for a port that ships all three', async () => {
    const document = await render('go')
    const options = [...document.querySelectorAll<HTMLInputElement>('input[data-landing-product]')]
    expect(options.map((input) => input.value)).toEqual(['core', 'mcp', 'workspace'])
    expect(options.map((input) => input.closest('label')!.textContent!.trim())).toEqual(['Core API', 'MCP', 'Workspace Manager'])
    expect(options.map((input) => input.type)).toEqual(['radio', 'radio', 'radio'])
    expect(options.map((input) => input.checked)).toEqual([true, false, false])
    expect(new Set(options.map((input) => input.name)).size, 'one radio group').toBe(1)
  })

  it('keeps menu entries to labels', async () => {
    const document = await render('go')
    for (const label of document.querySelectorAll('.landing-products label')) expect(label.textContent!.trim().split(/\s+/).length).toBeLessThanOrEqual(3)
  })

  it('shows no selector where there is nothing to choose', async () => {
    for (const slug of ['lua', 'elixir', 'kotlin', 'scala', 'fsharp']) {
      const document = await render(slug)
      expect(document.querySelector('input[data-landing-product]'), slug).toBeNull()
      expect([...document.querySelectorAll('[data-landing-panel]')].map((panel) => panel.getAttribute('data-landing-panel')), slug).toEqual(['core'])
    }
  })

  it('fixes the Core API panel to the port, with its showcase even when the quickstart is its only example', async () => {
    // py has no capability programs of its own: its quickstart still shows in the showcase, as every port's does.
    const document = await render('py')
    const showcase = document.querySelector('[data-landing-panel="core"] [data-core-showcase]')!
    expect(showcase.getAttribute('data-core-showcase')).toBe('py')
    expect(showcase.getAttribute('data-links'), 'the showcase carries the panel links').toBe('2')
    expect(document.querySelector('[data-landing-panel="core"] [data-home-example]'), 'no second, plain quickstart').toBeNull()
    expect(document.querySelector('[data-landing-panel="core"] [data-package-install]')!.getAttribute('data-package-id')).toBe('core')
    expect(document.querySelector('[data-home-language]'), 'no language switcher').toBeNull()
  })

  it('keeps each tested excerpt, with its file, source and CI step, behind a link to embedding it', async () => {
    const document = await render('go')
    const entry = table.go!.mcp as LandingExcerpt
    const resolved = landingExcerpt(PORT_BY_SLUG.go!, 'mcp', table, cache)!
    const disclosure = document.querySelector('[data-landing-panel="mcp"] details[data-landing-excerpt]')!
    expect(disclosure.hasAttribute('open'), 'closed until asked for').toBe(false)
    expect(disclosure.querySelector('summary')!.textContent).toBe('Embed the server in a program')
    const block = disclosure.querySelector('pre')!
    expect(block.textContent).toBe(resolved.code)
    expect(block.getAttribute('data-title')).toBe(entry.file)
    expect(block.getAttribute('data-lang')).toBe('go')
    const caption = disclosure.querySelector('.landing-source')!
    expect(caption.querySelector('a')!.getAttribute('href')).toBe(resolved.sourceUrl)
    expect(caption.textContent).toContain(entry.ci.workflow)
    expect(caption.textContent).toContain(entry.ci.command)
  })

  it('opens the MCP tab with a sentence, the worked example, the install picker, then the links and the excerpt', async () => {
    const document = await render('rs')
    const panel = document.querySelector('[data-landing-panel="mcp"]')!
    const order = ['[data-landing-example="mcp"]', '[data-mcp-install]', '.landing-links', '[data-landing-excerpt]']
    const found = order.map((selector) => panel.querySelector(selector))
    found.forEach((element, index) => expect(element, order[index]).not.toBeNull())
    for (let index = 1; index < found.length; index += 1) {
      expect(found[index - 1]!.compareDocumentPosition(found[index]!) & 4, `${order[index - 1]} precedes ${order[index]}`).toBeTruthy()
    }
    const showcase = (await mcpShowcase('rs', 'latest'))!
    expect(panel.querySelector('.mcp-turn--user p')!.textContent).toBe(EXAMPLES.rs!.prompt)
    const calls = [...panel.querySelectorAll('.mcp-call')].map((row) => ({ tool: row.querySelector('.mcp-call__tool code')!.textContent, arguments: JSON.parse(row.querySelector('.mcp-call__args')!.textContent!) }))
    expect(calls).toEqual(EXAMPLES.rs!.steps.map((step) => ({ tool: step.tool, arguments: step.arguments })))
    expect(panel.querySelector('.mcp-call .mcp-tier')).not.toBeNull()
    expect([...panel.querySelectorAll('article.mcp-turn')].every((item) => item.querySelector('details.mcp-result pre'))).toBe(true)
    expect(panel.querySelector('.mcp-turn--answer q')!.textContent).toMatch(/2 passed/)
    const hrefs = [...panel.querySelectorAll('.landing-links a')].map((link) => link.getAttribute('href'))
    expect(hrefs).toContain('/rs/latest/mcp/#tools-by-tier')
    expect(hrefs).toContain(showcase.toolsHref)
  })

  it('names the MCP and Workspace panels with a screen-reader label, not a visible heading under the tab', async () => {
    const document = await render('go')
    for (const [product, label] of [['mcp', 'MCP'], ['workspace', 'Workspace Manager']] as const) {
      const heading = document.querySelector(`[data-landing-panel="${product}"] > h2`)!
      expect(heading.textContent).toBe(label)
      expect(heading.className).toBe('sr-only')
      expect(document.querySelector(`[data-landing-panel="${product}"]`)!.textContent).not.toContain('Start with')
    }
  })

  it('shows a worked example for every port that has one, and none for a port served by another port\'s package', async () => {
    for (const slug of ['py', 'ts', 'go', 'java', 'csharp', 'cxx', 'swift', 'ruby', 'julia']) {
      const document = await render(slug)
      expect(document.querySelectorAll(`[data-landing-panel="mcp"] [data-landing-example="mcp"] article.mcp-turn`), slug).toHaveLength(EXAMPLES[slug]!.steps.length)
    }
    const document = await render('powershell')
    const panel = document.querySelector('[data-landing-panel="mcp"]')!
    expect(panel.querySelector('[data-landing-example]'), 'no invented calls').toBeNull()
    expect(panel.querySelector('.mcp-turn')).toBeNull()
    expect(panel.querySelector('[data-mcp-install]')!.getAttribute('data-mcp-install')).toBe('csharp')
    expect(panel.querySelector('a[href="/powershell/latest/guides/mcp/"]')).not.toBeNull()
  })

  /** The ports whose showcase has one file, and the ports whose showcase has several. */
  const SINGLE = supportedPorts().filter((slug) => { const showcase = workspaceShowcase(slug); return showcase && !offersPicker(showcase) })
  const PICKER = supportedPorts().filter((slug) => { const showcase = workspaceShowcase(slug); return showcase && offersPicker(showcase) })
  /** The load command a page may claim for `example`: the program, only where a test runs it. */
  const claimed = (slug: string, example: ReturnType<typeof landingExample>) => (citedTest(example).via === 'cli' ? loadCommand(slug)?.program : undefined)

  it('covers every port that has a showcase, as one file or as a picker', () => {
    // Every port with a showcase now loads tmuxp's catalog, so none shows one file.
    expect(SINGLE.sort()).toEqual([])
    expect(PICKER.sort()).toEqual(['csharp', 'cxx', 'go', 'julia', 'powershell', 'py', 'rs', 'ruby', 'ts'])
  })

  it('shows a port with one tested workspace file as that file alone: the panes it builds, its command and its evidence', async () => {
    for (const slug of SINGLE) {
      const document = await render(slug)
      const panel = document.querySelector('[data-landing-panel="workspace"]')!
      const showcase = workspaceShowcase(slug)!
      const example = landingExample(showcase)
      const body = panel.querySelector('[data-landing-example="workspace"]')!
      expect(body.querySelector('[data-workspace-picker], libtmux-workspace-picker, [data-preset]'), `${slug} has nothing to choose`).toBeNull()
      expect(body.querySelector('h3')!.textContent, slug).toBe(TOPICS.find((topic) => topic.id === example.topic)!.title)
      expect(body.querySelector('.ws-config__panel--yaml pre')!.textContent, slug).toBe(example.yaml)
      expect(body.querySelectorAll('.ws-windows .ws-win svg').length, `${slug} drawn windows`).toBeGreaterThan(0)
      const test = citedTest(example)
      const evidence = body.querySelector('[data-landing-evidence]')!
      expect(evidence.querySelector('a')!.getAttribute('href'), slug).toBe(revisionUrl(showcase, example.source.path, example.source.lines))
      expect(evidence.textContent, slug).toContain(VIA[test.via])
      const program = claimed(slug, example)
      const command = [...body.querySelectorAll('pre')].map((pre) => pre.textContent!).find((text) => text.includes(' load workspace.yaml'))
      expect(command, slug).toBe(program ? `${program} load workspace.yaml` : undefined)
      const after = ['[data-package-install]', '.landing-links', '[data-landing-excerpt]'].map((selector) => panel.querySelector(selector))
      expect(body.compareDocumentPosition(after[0] ?? after[1]!) & 4, `${slug} install follows the example`).toBeTruthy()
    }
  })

  it('offers the overview\'s preset picker for every port whose showcase has several files', async () => {
    for (const slug of PICKER) {
      const document = await render(slug)
      const panel = document.querySelector('[data-landing-panel="workspace"]')!
      const showcase = workspaceShowcase(slug)!
      const body = panel.querySelector('[data-landing-example="workspace"]')!
      expect(body.querySelectorAll('[data-workspace-picker]'), slug).toHaveLength(1)
      expect(body.querySelector('libtmux-workspace-picker')!.getAttribute('data-port'), slug).toBe(slug)
      expect(body.querySelector('details[data-preset-menu]'), `${slug} menu`).not.toBeNull()
      expect(body.querySelector('[data-action="roll"]'), `${slug} dice`).not.toBeNull()
      expect([...body.querySelectorAll<HTMLElement>('[data-preset]')].map((item) => item.dataset.preset).sort(), slug)
        .toEqual(showcase.examples.map((example) => example.topic).sort())
      expect(body.querySelector('h2'), `${slug} the page's heading names the section`).toBeNull()
      expect(document.getElementById('try-a-preset'), slug).toBeNull()
      expect(document.getElementById('explore-tmux-layout-workspace-possibilities'), slug).toBeNull()
      // The overview's examples carry the files in full; the landing page shows each file once.
      expect(body.querySelector('[data-workspace-showcase], .ws-example'), slug).toBeNull()
      expect(body.querySelectorAll('.ws-config__panel--yaml'), `${slug} one copy of each file`).toHaveLength(showcase.examples.length)
      const after = ['[data-package-install]', '.landing-links', '[data-landing-excerpt]'].map((selector) => panel.querySelector(selector))
      expect(body.compareDocumentPosition(after[0] ?? after[1]!) & 4, `${slug} install follows the picker`).toBeTruthy()
    }
  })

  it('opens the picker on the file the landing rule chooses, never on the short-hand fixture, and lists it first', async () => {
    for (const slug of PICKER) {
      const document = await render(slug)
      const showcase = workspaceShowcase(slug)!
      const opening = landingExample(showcase).topic
      const root = document.querySelector('libtmux-workspace-picker')!
      expect(opening, slug).not.toBe('shorthand')
      expect(root.querySelector('[data-first]')!.getAttribute('data-preset'), slug).toBe(opening)
      expect(root.querySelector('[data-preset-option][aria-current="true"]')!.getAttribute('data-preset-option'), slug).toBe(opening)
      expect(root.querySelector('[data-preset-option]')!.getAttribute('data-preset-option'), `${slug} first row`).toBe(opening)
      expect([...root.querySelectorAll<HTMLElement>('[data-preset]')].filter((panel) => !panel.hasAttribute('inert')).map((panel) => panel.dataset.preset), slug).toEqual([opening])
      expect(root.querySelector('summary')!.getAttribute('aria-label'), slug).toBe(`Preset: ${TOPICS.find((topic) => topic.id === opening)!.title}`)
      // The remaining rows keep the overview's order.
      const rest = [...root.querySelectorAll<HTMLElement>('[data-preset-option]')].slice(1).map((row) => row.dataset.presetOption)
      expect(rest, slug).toEqual(presetOptions(showcase).map((preset) => preset.id).filter((id) => id !== opening))
    }
  })

  it('gives each preset its own summary, command and evidence, so they follow the one on show', async () => {
    for (const slug of PICKER) {
      const document = await render(slug)
      const showcase = workspaceShowcase(slug)!
      for (const example of showcase.examples) {
        const panel = document.querySelector(`[data-preset="${example.topic}"]`)!
        const topic = TOPICS.find((entry) => entry.id === example.topic)!
        const test = citedTest(example)
        expect(panel.querySelector('.ws-picker__title')!.textContent, `${slug} ${example.topic}`).toBe(topic.title)
        expect(panel.querySelector('.ws-picker__summary')!.textContent, `${slug} ${example.topic}`).toBe(topic.summary)
        const links = [...panel.querySelectorAll('[data-landing-evidence] a')].map((link) => link.getAttribute('href'))
        expect(links, `${slug} ${example.topic}`).toEqual([revisionUrl(showcase, example.source.path, example.source.lines), revisionUrl(showcase, test.path, test.line)])
        expect(panel.querySelector('[data-landing-evidence]')!.textContent, `${slug} ${example.topic}`).toContain(VIA[test.via])
        const program = claimed(slug, example)
        const command = [...panel.querySelectorAll('pre')].map((pre) => pre.textContent!).find((text) => text.includes(' load workspace.yaml'))
        expect(command, `${slug} ${example.topic} command`).toBe(program ? `${program} load workspace.yaml` : undefined)
      }
    }
  })

  it('names the load command only for the presets a test runs it on', async () => {
    const commands = async (slug: string) => {
      const document = await render(slug)
      return Object.fromEntries(workspaceShowcase(slug)!.examples.map((example) => [example.topic, document.querySelector(`[data-preset="${example.topic}"]`)!.textContent!.includes('load workspace.yaml')]))
    }
    expect(Object.values(await commands('ts')).every(Boolean), 'every TypeScript file is loaded through the CLI').toBe(true)
    for (const slug of ['py', 'rs', 'cxx']) expect(Object.values(await commands(slug)).some(Boolean), `${slug}: no test runs the command`).toBe(false)
    // PowerShell loads through cmdlets, which the CLI manual does not list as a program.
    expect(Object.values(await commands('powershell')).some(Boolean)).toBe(false)
  })

  it('shows one complete example before script runs: the opening file in full, its drawing, its command and its evidence', async () => {
    const document = await render('ts')
    const showcase = workspaceShowcase('ts')!
    const example = landingExample(showcase)
    const shown = document.querySelector('libtmux-workspace-picker [data-first]')!
    // Script adds the menu and shows every preset; without it the opening file is the only one displayed.
    const others = [...document.querySelectorAll<HTMLElement>('[data-preset]')].filter((panel) => panel !== shown)
    expect(others.length).toBeGreaterThan(0)
    for (const panel of others) expect(panel.hasAttribute('data-first'), panel.dataset.preset).toBe(false)
    expect(shown.querySelector('.ws-picker__title')!.textContent).toBe(TOPICS.find((topic) => topic.id === example.topic)!.title)
    expect(shown.querySelector('.ws-config__panel--yaml pre')!.textContent).toBe(example.yaml)
    expect(shown.querySelectorAll('svg.gp-tmux-layout').length).toBeGreaterThan(0)
    expect([...shown.querySelectorAll('pre')].map((pre) => pre.textContent)).toContain('tmux-workspace load workspace.yaml')
    expect(shown.querySelector('[data-landing-evidence]')).not.toBeNull()
    const css = readFileSync(new URL('../src/styles/workspace-picker.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.ws-picker__panel:not\(\[data-first\]\)\s*\{\s*display: none;/)
    expect(css).toMatch(/html\[data-js\] \.ws-picker__title\s*\{\s*display: none;/)
  })

  /** The Workspace tab's markup from its panel to the links under it, with code blocks reduced to their text. */
  const workspaceMarkup = (html: string) => /data-landing-panel="workspace"[\s\S]*?<ul class="landing-links"/.exec(html)![0]
  // Real code blocks add their highlighting to every file's text in the same way, so this bounds what the page itself adds to a preset.
  const BYTES_PER_PRESET = 12 * 1024

  it('keeps the Workspace tab\'s markup to a bounded size per preset, so a port with many files stays light', async () => {
    for (const slug of [...PICKER, ...SINGLE]) {
      const bytes = workspaceMarkup(await renderHtml(slug)).length
      const files = workspaceShowcase(slug)!.examples.length
      expect(bytes / files, `${slug}: ${bytes} bytes for ${files} file(s)`).toBeLessThan(BYTES_PER_PRESET)
    }
  })

  it('notices a landing page that carries each file twice, as the overview does with its picker and its examples', async () => {
    const examples = await loadAstroTemplate('components/workspace/WorkspaceShowcase.astro', { real: REAL, modules: { 'astro-expressive-code/components': { Code } } })
    const showcase = workspaceShowcase('ts')!
    const once = workspaceMarkup(await renderHtml('ts')).length
    const twice = once + (await renderAstroTemplate(examples, { props: { showcase } })).length
    expect(once / showcase.examples.length).toBeLessThan(BYTES_PER_PRESET)
    expect(twice / showcase.examples.length, 'control: the budget fails for a second copy').toBeGreaterThan(BYTES_PER_PRESET)
  })

  it('links the overview\'s example workspaces, not a picker the page already has', async () => {
    for (const slug of ['ts', 'go']) {
      const document = await render(slug)
      const hrefs = [...document.querySelectorAll('[data-landing-panel="workspace"] .landing-links a')].map((link) => link.getAttribute('href'))
      expect(hrefs, slug).toContain(`/${slug}/latest/workspace/#example-workspaces`)
      expect(hrefs.some((href) => href!.includes('try-a-preset')), slug).toBe(false)
    }
  })

  it('shows a workspace file whose test runs the command in preference to one only the library loads', () => {
    expect(landingExample(workspaceShowcase('ts')!).tests.some((test) => test.via === 'cli')).toBe(true)
    const file = (topic: string, via: string) => ({ topic, tests: [{ via }], json: '{"windows":[{"panes":["a"]}]}' })
    expect(landingExample({ examples: [file('shorthand', 'library'), file('two-pane', 'cli')] } as never).topic).toBe('two-pane')
  })

  it('shows the install and links, no workspace file, for a port with none tested', async () => {
    const document = await render('java')
    const panel = document.querySelector('[data-landing-panel="workspace"]')!
    expect(panel.querySelector('[data-landing-example]')).toBeNull()
    expect(panel.querySelector('[data-package-install]')).not.toBeNull()
    expect(panel.querySelector('a[href="/java/latest/workspace/"]')).not.toBeNull()
    expect(panel.querySelector('[data-landing-excerpt]'), 'the excerpt stays behind its link').not.toBeNull()
  })

  it('keeps the full install widget of each product in its panel', async () => {
    const document = await render('ts')
    const within = (product: string, selector: string) => document.querySelector(`[data-landing-panel="${product}"] ${selector}`)
    expect(within('core', '[data-package-install]')!.getAttribute('data-package-id')).toBe('core')
    expect(within('mcp', '[data-mcp-install]')!.getAttribute('data-mcp-install')).toBe('ts')
    expect(within('workspace', '[data-package-install]')!.getAttribute('data-package-id')).toBe('workspace')
    expect(within('mcp', '[data-package-install]')).toBeNull()
  })

  it('installs the .NET tool in the PowerShell MCP panel', async () => {
    const document = await render('powershell')
    expect(document.querySelector('[data-landing-panel="mcp"] [data-mcp-install]')!.getAttribute('data-mcp-install')).toBe('csharp')
    expect(document.querySelector('[data-landing-panel="mcp"] a[href="/powershell/latest/guides/mcp/"]')).not.toBeNull()
    expect(document.querySelector('[data-landing-panel="mcp"] .landing-note')!.textContent).toMatch(/PowerShell has no MCP package of its own.*C# port's LibTmux\.Mcp/)
    expect(document.querySelector('[data-landing-panel="workspace"] .landing-note'), 'Workspace Manager is PowerShell\'s own').toBeNull()
  })

  it('shows an excerpt in every panel but the one the port has no program for', async () => {
    for (const port of PORTS) {
      const document = await render(port.slug)
      for (const product of landingProducts(port).filter((candidate): candidate is DocProduct => candidate !== 'core')) {
        const gap = port.slug === 'julia' && product === 'mcp'
        const excerpt = document.querySelector(`[data-landing-panel="${product}"] [data-landing-excerpt]`)
        expect(excerpt === null, `${port.slug} ${product}`).toBe(gap)
        if (excerpt) expect(excerpt.querySelector('pre')!.textContent, `${port.slug} ${product}`).toBe(landingExcerpt(port, product, table, cache)!.code)
      }
    }
  })

  it('keeps the install widget and the documentation link where the port has no program for a product', async () => {
    const document = await render('julia')
    expect(document.querySelector('[data-landing-panel="mcp"] [data-landing-excerpt]')).toBeNull()
    expect(document.querySelector('[data-landing-panel="mcp"] [data-mcp-install]')!.getAttribute('data-mcp-install')).toBe('julia')
    expect(document.querySelector('[data-landing-panel="mcp"] a[href="/julia/latest/mcp/"]')).not.toBeNull()
  })
})

describe('the version root of a port', () => {
  afterEach(() => vi.unstubAllEnvs())

  async function renderRoot(slug: string) {
    vi.stubEnv('LIBTMUX_DOCS_PORT', slug)
    vi.stubEnv('LIBTMUX_DOCS_LOCALE', 'en')
    vi.stubEnv('LIBTMUX_DOCS_VERSION', 'latest')
    const page = await loadAstroTemplate('pages/index.astro', {
      real: ['components/PortLanding.astro', 'components/DocCard.astro', ...REAL],
      stubs: { ...stubs, 'layouts/DocsLayout.astro': '---\n---\n<main><slot /></main>' },
      modules: {
        'astro-expressive-code/components': { Code },
        'astro:content': { getCollection: async () => [], render: async () => ({}) },
        '../i18n/resolve': { ALL_TRANSLATED: {}, buildLocale: () => 'en', localesFor: async () => ['en'] },
        '../lib/documentation-navigation': { getDocumentationSurfaces: async () => [] },
      },
    })
    const window = new Window()
    window.document.body.innerHTML = await renderAstroTemplate(page, { url: `https://libtmux.org/en/${slug}/latest/` })
    return window.document as unknown as Document
  }

  it('keeps Haskell landing links within the registered public documentation', async () => {
    const document = await renderRoot('haskell')
    const targets = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].map((link) => link.getAttribute('href')!)
    expect(targets.some((href) => /\/haskell\/latest\/guides\/$/.test(href))).toBe(true)
    expect(targets.filter((href) => /\/haskell\/latest\/(examples|topics|concepts)\//.test(href))).toEqual([])
    const links = JSON.parse(document.querySelector('[data-core-showcase]')!.getAttribute('data-link-targets')!) as { href: string }[]
    expect(links.map((link) => link.href)).toEqual(['/haskell/latest/core/', '/haskell/latest/guides/'])
  })

  it('lists each example program and its workflow once, in a footer after the cards', async () => {
    const document = await renderRoot('ocaml')
    const footer = document.querySelector('[data-ci-examples]')!
    expect(footer.querySelector('p')!.textContent).toBe("Example programs, each run by the port's CI:")
    const items = [...footer.querySelectorAll('li')]
    expect(items.length).toBeGreaterThan(1)
    expect(items[0]!.textContent).toBe('examples/showcase_graph.ml in .github/workflows/ocaml.yml')
    expect(items[0]!.querySelector('a')!.getAttribute('href')).toMatch(/^https:\/\/github\.com\/.+\/blob\/[0-9a-f]{40}\/examples\/showcase_graph\.ml$/)
    expect(footer.nextElementSibling, 'nothing follows the footer').toBeNull()
  })

  it('offers the selector instead of one long install list', async () => {
    const document = await renderRoot('go')
    expect(document.querySelectorAll('[data-port-landing]')).toHaveLength(1)
    expect(document.querySelector('[data-port-landing]')!.getAttribute('data-port-landing')).toBe('go')
    expect([...document.querySelectorAll<HTMLInputElement>('input[data-landing-product]')].map((input) => input.value)).toEqual(['core', 'mcp', 'workspace'])
    expect([...document.querySelectorAll('h2')].map((heading) => heading.textContent!.trim())).not.toContain('Install')
  })

  it('installs each product once, inside its own panel', async () => {
    const document = await renderRoot('go')
    expect(document.querySelectorAll('[data-package-install]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-mcp-install]')).toHaveLength(1)
    for (const widget of document.querySelectorAll('[data-package-install], [data-mcp-install]')) expect(widget.closest('[data-landing-panel]')).not.toBeNull()
  })

  it('shows a port that ships only the library as that library alone', async () => {
    const document = await renderRoot('lua')
    expect(document.querySelector('input[data-landing-product]')).toBeNull()
    expect(document.querySelectorAll('[data-landing-panel]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-package-install]')).toHaveLength(1)
  })
})

describe('the product panels of a port page', () => {
  it('names each panel from its tab, so the tab says what it controls', async () => {
    const document = await render('go')
    const tabs = [...document.querySelectorAll<HTMLInputElement>('input[data-landing-product]')]
    expect(tabs.map((input) => input.getAttribute('aria-controls'))).toEqual(['landing-panel-core', 'landing-panel-mcp', 'landing-panel-workspace'])
    for (const tab of tabs) expect(document.getElementById(tab.getAttribute('aria-controls')!)!.getAttribute('data-landing-panel'), tab.value).toBe(tab.value)
    expect(new Set([...document.querySelectorAll('[id]')].map((element) => element.id)).size, 'ids are unique').toBe(document.querySelectorAll('[id]').length)
  })

  it('refuses to render a port that has no homepage example, rather than a bare heading', async () => {
    await expect(renderHtml('go', { '../lib/quickstarts': { QUICKSTARTS: {}, homeCodeColumns: () => 80 } })).rejects.toThrow(/PortLanding: go has no complete homepage example/)
  })
})

/**
 * The selector's script, evaluated in a DOM the way install-widgets.test.ts
 * evaluates the install widgets', against the markup the component renders.
 * Each behaviour has a control: the same script with that one handler
 * disabled must leave the page as it was, so a test that passes without its
 * handler is caught here.
 */
describe('the selector script', () => {
  const PAGE = 'https://libtmux.org/en/go/latest/'
  const component = readFileSync(new URL('../src/components/PortLanding.astro', import.meta.url), 'utf8')
  const script = /<script>([\s\S]*?)<\/script>/.exec(component)![1]!
  const address = readFileSync(new URL('../src/lib/landing-selection.ts', import.meta.url), 'utf8')
  const commonjs = (source: string) => transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText

  /** `source` with the code `pattern` matches replaced, which must change it. */
  function without(source: string, pattern: RegExp, replacement = ''): string {
    const changed = source.replace(pattern, replacement)
    expect(changed, `the script still has ${pattern}`).not.toBe(source)
    return changed
  }

  async function mount(url: string, disabled?: (source: string) => string, { slug = 'go', picker = false } = {}) {
    const window = new Window({ url })
    window.document.body.innerHTML = await renderHtml(slug)
    if (picker) window.eval(`(() => {\n${PICKER_CLIENT}\ndefineWorkspacePicker()\n})()`)
    const helpers: { exports: Record<string, unknown> } = { exports: {} }
    window.eval(`(function(module, exports) {\n${commonjs(address)}\n})`)(helpers, helpers.exports)
    const source = commonjs(disabled ? disabled(script) : script)
    window.eval(`(function(require, module, exports) {\n${source}\n})`)(() => helpers.exports, { exports: {} }, {})
    return window
  }

  const dom = (window: Window) => window.document as unknown as Document
  const chosen = (window: Window) => [...dom(window).querySelectorAll<HTMLInputElement>('input[data-landing-product]')].filter((input) => input.checked).map((input) => input.value)
  const choose = (window: Window, product: string) => {
    const input = dom(window).querySelector<HTMLInputElement>(`input[data-landing-product][value="${product}"]`)!
    input.checked = true
    input.dispatchEvent(new window.Event('change', { bubbles: true }) as unknown as Event)
  }

  it('selects the product the address names when the page loads', async () => {
    expect(chosen(await mount(`${PAGE}?product=mcp`))).toEqual(['mcp'])
    expect(chosen(await mount(`${PAGE}?cleanup=1&product=workspace`))).toEqual(['workspace'])
    expect(chosen(await mount(`${PAGE}?product=unknown`)), 'an unknown product leaves the first').toEqual(['core'])
    expect(chosen(await mount(`${PAGE}?product=mcp`, (source) => without(source, /\n    restore\(\)\n/, '\n'))), 'control: no restore on load').toEqual(['core'])
  })

  it('writes the choice to the address and keeps what else the address and history hold', async () => {
    const window = await mount(`${PAGE}?errors=1`)
    window.history.replaceState({ kept: true }, '')
    choose(window, 'mcp')
    expect(window.location.search).toBe('?errors=1&product=mcp')
    expect(window.history.state).toEqual({ kept: true })
    choose(window, 'workspace')
    expect(window.location.search).toBe('?errors=1&product=workspace')
    choose(window, 'core')
    expect(window.location.search, 'the first product leaves the address as it was').toBe('?errors=1')

    const control = await mount(PAGE, (source) => without(source, /document\.addEventListener\('change'/, "document.addEventListener('never'"))
    choose(control, 'mcp')
    expect(control.location.search, 'control: no change listener').toBe('')
  })

  it('follows the address back and forward on the same page', async () => {
    const window = await mount(PAGE)
    window.history.pushState({}, '', `${PAGE}?product=workspace`)
    window.dispatchEvent(new window.Event('popstate'))
    expect(chosen(window)).toEqual(['workspace'])
    window.history.pushState({}, '', PAGE)
    window.dispatchEvent(new window.Event('popstate'))
    expect(chosen(window), 'an address with no product is the first').toEqual(['core'])
    window.history.pushState({}, '', 'https://libtmux.org/en/go/latest/guides/?product=mcp')
    window.dispatchEvent(new window.Event('popstate'))
    expect(chosen(window), 'another page is not this selector\'s to restore').toEqual(['core'])

    const control = await mount(PAGE, (source) => without(source, /window\.addEventListener\('popstate'/, "window.addEventListener('never'"))
    control.history.pushState({}, '', `${PAGE}?product=workspace`)
    control.dispatchEvent(new control.Event('popstate'))
    expect(chosen(control), 'control: no popstate listener').toEqual(['core'])
    const unguarded = await mount(PAGE, (source) => without(source, /\n      if \(location\.pathname !== path\) return/, ''))
    unguarded.history.pushState({}, '', 'https://libtmux.org/en/go/latest/guides/?product=mcp')
    unguarded.dispatchEvent(new unguarded.Event('popstate'))
    expect(chosen(unguarded), 'control: no same-page guard').toEqual(['mcp'])
  })

  it('binds the markup a client-side navigation swaps in', async () => {
    const window = await mount(PAGE)
    const markup = window.document.body.innerHTML
    window.document.body.innerHTML = markup
    window.history.replaceState({}, '', `${PAGE}?product=workspace`)
    window.document.dispatchEvent(new window.Event('astro:after-swap'))
    expect(chosen(window)).toEqual(['workspace'])
    choose(window, 'mcp')
    expect(window.location.search, 'the swapped-in inputs write their choice too').toBe('?product=mcp')

    const control = await mount(PAGE, (source) => without(source, /document\.addEventListener\('astro:after-swap'/, "document.addEventListener('never'"))
    control.document.body.innerHTML = markup
    control.history.replaceState({}, '', `${PAGE}?product=workspace`)
    control.document.dispatchEvent(new control.Event('astro:after-swap'))
    expect(chosen(control), 'control: no rebinding after a swap').toEqual(['core'])
  })

  describe('beside the preset picker', () => {
    const TS = 'https://libtmux.org/en/ts/latest/'
    const shown = (window: Window) => dom(window).querySelector('libtmux-workspace-picker')!.getAttribute('data-selected')
    const reachable = (window: Window) => [...dom(window).querySelectorAll<HTMLElement>('[data-preset]')].filter((panel) => !panel.inert).map((panel) => panel.dataset.preset)
    const pick = (window: Window, id: string) => dom(window).querySelector<HTMLElement>(`[data-preset-option="${id}"]`)!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }) as unknown as Event)
    const open = (url: string, disabled?: (source: string) => string) => mount(url, disabled, { slug: 'ts', picker: true })
    const opening = landingExample(workspaceShowcase('ts')!).topic

    it('opens the Workspace Manager tab on the opening file, then on the preset the address names', async () => {
      const first = await open(`${TS}?product=workspace`)
      expect(chosen(first)).toEqual(['workspace'])
      expect(shown(first)).toBe(opening)
      expect(reachable(first)).toEqual([opening])
      const named = await open(`${TS}?product=workspace&preset=environment`)
      expect(chosen(named)).toEqual(['workspace'])
      expect(shown(named)).toBe('environment')
      expect(reachable(named)).toEqual(['environment'])
      expect(shown(await open(`${TS}?product=workspace&preset=no-such-preset`)), 'a preset the port lacks is the opening one').toBe(opening)
    })

    it('records a choice beside the product, and leaves the product alone', async () => {
      const window = await open(`${TS}?product=workspace`)
      pick(window, 'environment')
      expect(window.location.search).toBe('?product=workspace&preset=environment')
      expect(shown(window)).toBe('environment')
      expect(chosen(window), 'choosing a preset keeps the tab').toEqual(['workspace'])
      expect(window.localStorage.getItem(`${STORAGE_PREFIX}ts`), 'the overview\'s slot').toBe('environment')
    })

    it('keeps the preset when the tabs change, and the tab when the preset changes', async () => {
      const window = await open(`${TS}?product=workspace&preset=environment`)
      choose(window, 'mcp')
      expect(window.location.search).toBe('?product=mcp&preset=environment')
      expect(shown(window), 'the picker is hidden, not reset').toBe('environment')
      choose(window, 'core')
      expect(window.location.search, 'the first tab leaves the preset, which the picker still holds').toBe('?preset=environment')
      choose(window, 'workspace')
      expect(shown(window)).toBe('environment')
      pick(window, 'four-pane')
      expect(Object.fromEntries(new URLSearchParams(window.location.search))).toEqual({ product: 'workspace', preset: 'four-pane' })
    })

    it('does not open the Workspace Manager tab for an address that only names a preset', async () => {
      const window = await open(`${TS}?preset=environment`)
      expect(chosen(window), 'the product tabs own the tab').toEqual(['core'])
      expect(shown(window), 'but the tab shows the named preset when opened').toBe('environment')
    })

    it('restores the tab from the history without changing the preset', async () => {
      const window = await open(TS)
      choose(window, 'workspace')
      pick(window, 'sleep')
      window.history.pushState({}, '', `${TS}?product=mcp&preset=sleep`)
      window.dispatchEvent(new window.Event('popstate'))
      expect(chosen(window)).toEqual(['mcp'])
      expect(shown(window)).toBe('sleep')
    })

    it('shows the preset last chosen on the overview, as the overview does', async () => {
      const window = new Window({ url: `${TS}?product=workspace` })
      window.localStorage.setItem(`${STORAGE_PREFIX}ts`, 'window-index')
      window.document.body.innerHTML = await renderHtml('ts')
      window.eval(`(() => {\n${PICKER_CLIENT}\ndefineWorkspacePicker()\n})()`)
      expect(shown(window)).toBe('window-index')
    })
  })
})

describe('the quickstart code height', () => {
  it('is fixed wherever the quickstart is shown, so a toggle moves nothing', () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
    expect(read('../src/components/HomeExample.astro')).toMatch(/\[data-fixed\] \.home-example-view :global\(\.expressive-code pre\) \{ height: calc\(34rem - var\(--home-toolbar-row, 0rem\)\);/)
    // The landing and the Core home show the quickstart through the showcase, which fixes it.
    expect(read('../src/components/CoreShowcase.astro')).toMatch(/<HomeExample [^>]*\bfixed\b/)
    for (const path of ['../src/components/CoreHome.astro', '../src/components/PortLanding.astro']) {
      expect(read(path), path).not.toMatch(/<HomeExample\b/)
      expect(read(path), path).toMatch(/<CoreShowcase\b/)
    }
  })
})
