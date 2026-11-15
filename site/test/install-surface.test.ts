import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import { buildPanels, markPlaceholders, SERVERS } from '../src/lib/install-matrix'
import { addedLines, channelForms, markAddedLines, promptFor, targetParts, withPrompt } from '../src/lib/install-surface'
import { formTarget, PORTS, type InstallCommand } from '../src/lib/ports'
import { installsFor, REGISTRY } from '../src/lib/registry'
import { HOME_PORT_PREVIEW_EVENT } from '../src/lib/home-hover-preview'
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
})

/** Every install the pickers offer, with the port and package it belongs to. */
const installs: { where: string; install: InstallCommand }[] = PORTS.flatMap((port) => [
  ...port.installs.map((install) => ({ where: `${port.slug} ${install.label}`, install })),
  ...(port.packages ?? []).flatMap((pkg) => (pkg.installs ?? []).map((install) => ({ where: `${port.slug} ${pkg.id} ${install.label}`, install }))),
])

describe('where each install goes', () => {
  const target = (slug: string, label: string) => installs.find((entry) => entry.where === `${slug} ${label}`)?.install.target

  it('names a target for every install', () => {
    expect(installs.length).toBeGreaterThan(80)
    expect(installs.filter(({ install }) => !install.target).map(({ where }) => where)).toEqual([])
  })

  it('says Terminal for a command, and the file for a snippet that has one', () => {
    expect(installs.filter(({ install }) => install.lang === 'console' && install.target !== 'Terminal').map(({ where }) => where)).toEqual([])
    expect(installs.filter(({ install }) => install.filename && install.target !== install.filename).map(({ where }) => where)).toEqual([])
  })

  it('names the file or console of the .NET and Java installs', () => {
    expect(target('csharp', 'PMC')).toBe('Package Manager Console')
    expect(target('csharp', 'CPM')).toBe('Directory.Packages.props')
    expect(target('csharp', 'PackageReference')).toBe('.csproj')
    expect(target('fsharp', 'PackageReference')).toBe('.fsproj')
    expect(target('java', 'Maven')).toBe('pom.xml')
    expect(target('java', 'Gradle')).toBe('build.gradle.kts')
  })

  it('names where a channel form goes, and never a language id', () => {
    const forms = PORTS.flatMap((port) => (['release', 'prerelease', 'git'] as const).map((channel) => ({ where: `${port.slug} ${channel}`, form: port.installForms[channel] })))
    expect(forms.filter(({ form }) => form.lang === 'console' && formTarget(form) !== 'Terminal').map(({ where }) => where)).toEqual([])
    expect(forms.filter(({ form }) => formTarget(form) === form.lang && form.lang !== 'console').map(({ where }) => where)).toEqual([])
    expect(formTarget(PORTS.find((port) => port.slug === 'cxx')!.installForms.git)).toBe('CMakeLists.txt')
  })

  it('names a target for the source install a port with no release falls back to', () => {
    const unpublished = PORTS.filter((port) => installsFor(port).some((install) => install.label === 'Source'))
    for (const port of unpublished) expect(installsFor(port).find((install) => install.label === 'Source')!.target, port.slug).toBeTruthy()
  })
})

describe('MCP cooldown refusals', () => {
  const panel = (port: string, method: string, cooldown: string, client = 'claude-code') =>
    buildPanels(SERVERS[port]!, 'a'.repeat(40)).find((entry) => entry.client.id === client && entry.method.id === method && entry.cooldown.id === cooldown)!

  it('gives the reason where a method cannot take the cooldown, apart from the panel\'s own note', () => {
    expect(panel('py', 'pipx', 'days').cooldownReason).toBe('pipx has no per-package cooldown override, so this snippet runs without cooldown enforcement.')
    expect(panel('py', 'pip', 'bypass').cooldownReason).toMatch(/^pip has no per-package cooldown override/)
    expect(panel('ts', 'npx', 'days').cooldownReason).toMatch(/^npx ignores --min-release-age-exclude/)
    expect(panel('py', 'pipx', 'days').note).toBeNull()
  })

  it('gives none where the cooldown changes the command, or where it is off', () => {
    expect(panel('py', 'uvx', 'days').cooldownReason).toBeNull()
    expect(panel('py', 'uvx', 'bypass').cooldownReason).toBeNull()
    expect(panel('ts', 'global', 'days').cooldownReason).toBeNull()
    expect(panel('ts', 'npx', 'bypass').cooldownReason).toBeNull()
    expect(panel('py', 'pipx', 'off').cooldownReason).toBeNull()
  })

  it('keeps a caveat that holds whatever the cooldown', () => {
    expect(panel('ts', 'global', 'days').note).toMatch(/^The package installs a `libtmux-mcp` binary/)
  })
})

describe('placeholder paths', () => {
  const source = '<span class="line"><span style="--shiki-light:#032f62">"/absolute/path/to/project/bin/libtmux-mcp"</span><span> --socket /absolute/path/to/tmux.sock</span></span>'

  it('marks a path the reader replaces, in its own span and with a title', () => {
    const marked = markPlaceholders(source)
    expect(marked.match(/<span class="lm-install__slot" title="Replace with the real path">/g)).toHaveLength(2)
    expect(marked).toContain('>/absolute/path/to/project/bin/libtmux-mcp</span>')
    expect(marked).toContain('>/absolute/path/to/tmux.sock</span>')
  })

  it('leaves the text as written, so Copy keeps the placeholder verbatim', () => {
    const text = (html: string) => { const window = openWindow(); window.document.body.innerHTML = html; return window.document.body.textContent }
    expect(text(markPlaceholders(source))).toBe(text(source))
  })

  it('marks nothing in a command with no placeholder', () => {
    expect(markPlaceholders('<span>cargo install tmux-mcp</span>')).toBe('<span>cargo install tmux-mcp</span>')
  })

  it('finds the placeholder in the MCP servers that build from source', () => {
    const bodies = Object.values(SERVERS).flatMap((spec) => buildPanels(spec, 'a'.repeat(40)).map((panel) => panel.body))
    expect(bodies.filter((body) => body.includes('/absolute/path/to/')).length).toBeGreaterThan(20)
  })
})

describe('what the surface draws around the code', () => {
  it('draws the prompt of the place the code runs', () => {
    expect(promptFor('Terminal', 'console')).toBe('$')
    expect(promptFor('PowerShell', 'powershell')).toBe('PS>')
    expect(promptFor('Package Manager Console', 'powershell')).toBe('PM>')
    expect(promptFor('pom.xml', 'xml')).toBe('')
    expect(promptFor('Julia REPL', 'julia')).toBe('')
  })

  it('puts the prompt before the first line only', () => {
    const html = '<span class="line"><span>Install-Module</span></span>\n<span class="line"><span>-Name X</span></span>'
    const shown = withPrompt(html, 'PS>')
    expect(shown.startsWith('<span class="line"><span class="lm-shell-prompt"')).toBe(true)
    expect(shown.match(/class="lm-shell-prompt"/g)).toHaveLength(1)
    expect(shown).toContain('PS&gt; </span><span>Install-Module</span>')
  })

  it('cuts a long file target at its folder and never at its file name', () => {
    expect(targetParts('~/.gemini/config/mcp_config.json')).toEqual({ dir: '~/.gemini/config/', base: 'mcp_config.json' })
    expect(targetParts('pom.xml')).toEqual({ dir: '', base: 'pom.xml' })
    expect(targetParts('Package Manager Console')).toEqual({ dir: '', base: 'Package Manager Console' })
  })

  it('marks the lines a cooldown adds to the plain command, as a diff marks an insertion', () => {
    const plain = 'npm install libtmux'
    const cooldown = 'npm install \\\n    --min-release-age=<COOLDOWN_DAYS> \\\n    --min-release-age-exclude=libtmux \\\n    libtmux'
    expect(addedLines(plain, cooldown)).toEqual([1, 2])
    expect(addedLines('npx -y @libtmux/workspace-cli --help', 'npx -y --min-release-age=0 @libtmux/workspace-cli --help')).toEqual([0])
    expect(addedLines(plain, plain)).toEqual([])
  })

  it('adds the mark to those lines of the highlighted code', () => {
    const html = '<span class="line">a</span>\n<span class="line">b</span>\n<span class="line">c</span>'
    expect(markAddedLines(html, [1])).toBe('<span class="line">a</span>\n<span class="line is-added">b</span>\n<span class="line">c</span>')
    expect(markAddedLines(html, [])).toBe(html)
  })
})

describe('release channels', () => {
  const port = (slug: string) => PORTS.find((entry) => entry.slug === slug)!
  const entry = (status: 'release' | 'prerelease' | 'unpublished', fields: { version?: string | null; tag?: string | null } = {}) =>
    ({ status, version: fields.version ?? null, release: status === 'release' ? fields.version ?? null : null, tag: fields.tag ?? null })

  it('offers From Git beside a final release, with its tag filled, and no pre-release to point at', () => {
    const channels = channelForms(port('py'), entry('release', { version: '0.62.0', tag: 'v0.62.0' }))
    expect(channels.map((channel) => channel.id)).toEqual(['git'])
    expect(channels[0]!.label).toBe('From Git')
    expect(channels[0]!.code).toContain('v0.62.0')
    expect(channels[0]!.code).not.toContain('{tag}')
  })

  it('offers the pre-release when the newest version on the registry is one, with its version filled', () => {
    const channels = channelForms(port('py'), entry('prerelease', { version: '0.63.0a1', tag: 'v0.63.0a1' }))
    expect(channels.map((channel) => channel.id)).toEqual(['prerelease', 'git'])
    expect(channels[0]!.label).toBe('Pre-release')
    expect(channels[0]!.code).toContain('0.63.0a1')
    expect(channels[0]!.target).toBe('Terminal')
  })

  it('names where a source install goes, and offers nothing it cannot fill', () => {
    expect(channelForms(port('cxx'), entry('unpublished', { tag: 'v0.1.0' })).find((channel) => channel.id === 'git')!.target).toBe('CMakeLists.txt')
    expect(channelForms(port('py'), entry('unpublished'))).toEqual([])
  })
})

/** The package installer, rendered with its real parts and, where a test drives it, its real scripts. */
const widgets = new URL('../src/components/widgets/', import.meta.url)
async function renderPackage(props: Record<string, unknown>, options: { saved?: Record<string, string>; scripts?: boolean } = {}) {
  const template = await loadAstroTemplate('components/widgets/PackageInstall.astro', {
    real: ['InstallCode', 'InstallCooldown', 'InstallFacts', 'InstallWhere'].map((name) => `components/widgets/${name}.astro`),
    modules: { '../../lib/api-models': { API_MODELS: {} }, 'astro-expressive-code/components': { Code: () => '' } },
  })
  const window = openWindow()
  for (const [key, value] of Object.entries(options.saved ?? {})) window.localStorage.setItem(key, value)
  window.document.body.innerHTML = await renderAstroTemplate(template, { props })
  if (options.scripts) for (const file of ['PackageInstall', 'InstallCode']) hydrate(window, new URL(`${file}.astro`, widgets))
  return { window, document: window.document as unknown as Document }
}

/** Run the `<script>` of a component in a window, as the page would after its markup. */
function hydrate(window: Window, file: URL) {
  const script = readFileSync(file, 'utf8').match(/<script>([\s\S]*?)<\/script>/)![1]!
    .replace(/import \{ HOME_PORT_PREVIEW_EVENT \}[^\n]+/, `const HOME_PORT_PREVIEW_EVENT = ${JSON.stringify(HOME_PORT_PREVIEW_EVENT)}`)
  window.eval(ts.transpileModule(`(() => {${script}})()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'))
}

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

describe('the package installer draws one code surface', () => {
  it('puts the tool tabs, where the code goes and one Copy in the header, and the options bar above the code', async () => {
    const { document } = await renderPackage({ ports: ['py'] })
    const surface = document.querySelector('.lm-install')!
    const [head, bar, body] = ['.lm-install__head', '.lm-install__bar', '.lm-install__body'].map((selector) => surface.querySelector(selector)!)
    expect([...surface.children].map((child) => child.className)).toEqual([head, bar, body].map((child) => child.className))
    expect([...head.querySelectorAll('[role="tab"]')].map((tab) => text(tab).replace(' (no cooldown)', ''))).toEqual(['pip', 'uv', 'pipx'])
    expect(text(head.querySelector('.lm-install__headend .lm-pkg-install__cmd[data-default] .lm-install__target'))).toBe('Terminal')
    expect(head.querySelectorAll('.lm-install__headend [data-copy-key]').length).toBeGreaterThan(0)
    expect(body.querySelector('[data-action="copy"]')).toBeNull()
  })

  it('states the package facts, then the channel, with the cooldown at the right edge', async () => {
    const { document } = await renderPackage({ ports: ['py'] })
    const bar = document.querySelector('.lm-install__bar')!
    expect([...bar.children].map((child) => child.className)).toEqual(['lm-install__facts', 'lm-install__opts', 'lm-install__cd'])
    expect(text(bar.querySelector('.lm-install__facts code'))).toBe('libtmux')
    expect(bar.querySelector('.lm-install__facts a')?.getAttribute('href')).toBe('https://pypi.org/project/libtmux/')
    expect([...bar.querySelectorAll('[data-pkg-channel]')].map(text)).toEqual(['Release', 'From Git'])
    const toggle = bar.querySelector('[data-pkg-cooldown="toggle"]')!
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(text(toggle)).toBe('Cooldown')
  })

  it('says a port is not on a registry, and shows no cooldown where its tools have none', async () => {
    const { document } = await renderPackage({ ports: ['cxx'] })
    const bar = document.querySelector('.lm-install__bar')!
    expect(text(bar.querySelector('.lm-install__facts'))).toBe('libtmux-cxx Not on a registry yet')
    expect(bar.querySelector('[data-pkg-cooldown]')).toBeNull()
  })

  it('names one tool in place of tabs, with no cooldown control', async () => {
    const { document } = await renderPackage({ ports: ['rs'] })
    expect(document.querySelector('[role="tablist"]')).toBeNull()
    expect(text(document.querySelector('.lm-install__tabs .lm-pkg-install__label[data-channel="release"]'))).toBe('cargo')
  })

  it('names the place and draws the prompt of each .NET install', async () => {
    const { document } = await renderPackage({ ports: ['csharp'] })
    const target = (index: number) => text(document.querySelector(`.lm-install__headend .lm-pkg-install__cmd[data-manager="${index}"] .lm-install__target`))
    expect([target(1), target(2), target(3)]).toEqual(['Package Manager Console', '.csproj', 'Directory.Packages.props'])
    const pmc = document.querySelector('.lm-install__body .lm-pkg-install__cmd[data-manager="1"] [data-install-code]')!
    expect(pmc.getAttribute('data-prompt')).toBe('PM>')
    expect(text(pmc.querySelector('code'))).toMatch(/^PM> NuGet\\Install-Package LibTmux/)
  })

  it('carries a follow-up and a further file as strips with their own Copy', async () => {
    const { document } = await renderPackage({ ports: ['csharp'] })
    const strips = [...document.querySelectorAll('.lm-install__body .lm-pkg-install__cmd[data-manager="3"] .lm-pkg-install__code--strip')]
    expect(strips.map((strip) => text(strip.querySelector('.lm-install__k')))).toEqual(['Project file (.csproj or .fsproj)'])
    expect(strips[0]!.querySelector('[data-action="copy"]')).not.toBeNull()
    const workspace = (await renderPackage({ ports: ['py'], packageId: 'workspace' })).document
    const then = (index: number) => workspace.querySelector(`.lm-install__body .lm-pkg-install__cmd[data-manager="${index}"] .lm-pkg-install__code--after`)
    expect(text(then(0))).toContain('Then')
    expect(text(then(0))).toContain('tmuxp load ./workspace.yaml')
    // uvx runs the command once and installs nothing, so there is nothing to load with.
    expect(then(1)).toBeNull()
  })
})

describe('the cooldown is a strip beside the change', () => {
  const variant = (document: Document, manager: number, mode: string) =>
    document.querySelector(`.lm-install__body .lm-pkg-install__cmd[data-manager="${manager}"] [data-cooldown-variant="${mode}"]`)!

  it('holds back dependencies for a number of days, and marks the lines it adds', async () => {
    const { document } = await renderPackage({ ports: ['py'] })
    const days = variant(document, 1, 'days')
    const strip = days.querySelector('.lm-install__cooldown')!
    expect(strip.getAttribute('data-tone')).toBe('on')
    expect(text(strip)).toBe('Cooldown Holds back dependencies newer than days; libtmux itself stays current. Bypass instead Remove')
    expect(strip.querySelector<HTMLInputElement>('[data-cooldown-action="days"]')!.value).toBe('7')
    expect([...days.querySelectorAll('.line.is-added')].map(text)).toEqual(['--exclude-newer P7D \\', '--exclude-newer-package libtmux=2099-01-01 \\'])
    expect(variant(document, 1, 'off').querySelector('.lm-install__cooldown')).toBeNull()
  })

  it('says what a bypass does for this tool, for this install only', async () => {
    const { document } = await renderPackage({ ports: ['py'] })
    const strip = variant(document, 1, 'bypass').querySelector('.lm-install__cooldown')!
    expect(strip.getAttribute('data-tone')).toBe('bypass')
    expect(text(strip.querySelector('.lm-install__cooldown-body'))).toBe('Bypasses a cooldown set in your uv configuration, for this install only.')
    expect(text(strip.querySelector('.lm-install__acts'))).toBe('Use a cooldown Remove')
  })

  it('turns caution for a tool that cannot take one, gives the reason and offers uv', async () => {
    const { document } = await renderPackage({ ports: ['py'] })
    const strip = variant(document, 0, 'days').querySelector('.lm-install__cooldown')!
    expect(strip.getAttribute('data-tone')).toBe('caution')
    expect(text(strip.querySelector('.lm-install__cooldown-body'))).toMatch(/^pip cannot exempt libtmux from its own cooldown.* Use uv$/)
    expect(strip.querySelector('[data-cooldown-action="alt"]')?.getAttribute('data-cooldown-alt')).toBe('1')
    // The command is the plain one, with nothing marked as added.
    expect(variant(document, 0, 'days').querySelectorAll('.line.is-added')).toHaveLength(0)
    const bypass = variant(document, 0, 'bypass').querySelector('.lm-install__cooldown')!
    expect(bypass.getAttribute('data-tone')).toBe('caution')
    expect(bypass.querySelector('[data-cooldown-action="alt"]')).toBeNull()
  })

  it('carries a caution dot on the tab of a tool the setting cannot reach', async () => {
    const { document } = await renderPackage({ ports: ['ts'] })
    const tab = (label: string) => [...document.querySelectorAll('.lm-pkg-install__manager')].find((el) => text(el).startsWith(label))!
    expect(tab('bun').hasAttribute('data-no-days')).toBe(true)
    expect(tab('bun').hasAttribute('data-no-bypass')).toBe(false)
    expect(tab('npm').hasAttribute('data-no-days')).toBe(false)
    expect(tab('bun').querySelector('.lm-install__dot')).not.toBeNull()
  })
})

describe('the release channel', () => {
  it('offers the pre-release when the newest version on the registry is one', async () => {
    const original = REGISTRY.ports.py!
    try {
      REGISTRY.ports.py = { ...original, status: 'prerelease', version: '0.63.0a1', release: '0.62.0' }
      const { document } = await renderPackage({ ports: ['py'] })
      expect([...document.querySelectorAll('.lm-install__bar [data-pkg-channel]')].map(text)).toEqual(['Release', 'Pre-release', 'From Git'])
      expect(text(document.querySelector('.lm-install__body .lm-pkg-install__chan[data-channel="prerelease"] code'))).toContain('0.63.0a1')
      expect(text(document.querySelector('.lm-install__tabs .lm-pkg-install__label[data-channel="prerelease"]'))).toBe('Pre-release')
    } finally {
      REGISTRY.ports.py = original
    }
  })

  it('keeps the cooldown in place, disabled, outside the Release channel', async () => {
    const { window, document } = await renderPackage({ ports: ['py'] }, { scripts: true })
    const panel = document.querySelector<HTMLElement>('.lm-pkg-install__panel')!
    const toggle = panel.querySelector<HTMLButtonElement>('[data-pkg-cooldown="toggle"]')!
    ;(panel.querySelector('[data-pkg-channel="git"]') as HTMLElement).click()
    expect(panel.dataset.activeChannel).toBe('git')
    expect(panel.querySelector('[data-pkg-channel="git"]')!.getAttribute('aria-pressed')).toBe('true')
    expect(toggle.disabled).toBe(true)
    expect(toggle.title).toBe('Cooldowns apply to the Release channel.')
    toggle.click()
    expect(window.localStorage.getItem('libtmux-docs.mcp-install.cooldown.enabled')).toBeNull()
    ;(panel.querySelector('[data-pkg-channel="release"]') as HTMLElement).click()
    expect(toggle.disabled).toBe(false)
  })
})

describe('driving the cooldown strip', () => {
  const store = (window: Window, key: string) => window.localStorage.getItem(`libtmux-docs.mcp-install.cooldown.${key}`)
  const click = (document: Document, selector: string) => (document.querySelector(selector) as HTMLElement).click()

  it('turns on from the toggle, switches to a bypass and back, and removes', async () => {
    const { window, document } = await renderPackage({ ports: ['py'] }, { scripts: true })
    const toggle = '[data-pkg-cooldown="toggle"]'
    click(document, toggle)
    expect(document.documentElement.getAttribute('data-mcp-install-cooldown-enabled')).toBe('1')
    expect(document.querySelector(toggle)!.getAttribute('aria-pressed')).toBe('true')
    expect(store(window, 'enabled')).toBe('1')
    click(document, '[data-cooldown-action="bypass"]')
    expect(document.documentElement.getAttribute('data-mcp-install-cooldown-type')).toBe('bypass')
    expect(store(window, 'type')).toBe('bypass')
    click(document, '[data-cooldown-action="days-mode"]')
    expect(store(window, 'type')).toBe('days')
    click(document, '[data-cooldown-action="remove"]')
    expect(store(window, 'enabled')).toBe('0')
    expect(document.querySelector(toggle)!.getAttribute('aria-pressed')).toBe('false')
  })

  it('writes the day count in each tool\'s unit, in every command at once', async () => {
    const { window, document } = await renderPackage({ ports: ['py'] }, { scripts: true })
    const input = document.querySelector<HTMLInputElement>('[data-cooldown-action="days"]')!
    input.value = '14'
    input.dispatchEvent(new window.Event('change', { bubbles: true }) as unknown as Event)
    expect(store(window, 'days')).toBe('14')
    expect(store(window, 'enabled')).toBe('1')
    expect(text(document.querySelector('.lm-install__body [data-manager="1"] [data-cooldown-variant="days"] code'))).toContain('--exclude-newer P14D')
  })

  it('moves to the tool that can, from the strip that says the tool cannot', async () => {
    const { window, document } = await renderPackage({ ports: ['py'] }, { scripts: true })
    click(document, '[data-pkg-cooldown="toggle"]')
    click(document, '.lm-install__body [data-manager="0"] [data-cooldown-variant="days"] [data-cooldown-action="alt"]')
    expect(document.querySelector('.lm-pkg-install__panel')!.getAttribute('data-active-manager')).toBe('1')
    expect(document.querySelector('.lm-pkg-install__manager[aria-selected="true"]')!.textContent).toContain('uv')
    expect(window.localStorage.getItem('libtmux-docs.package-install.manager.py')).toBe('1')
  })

  it('copies the cooldown command as shown, with the day count in force and no prompt', async () => {
    const { window, document } = await renderPackage({ ports: ['py'] }, { scripts: true })
    const copied: string[] = []
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async (value: string) => { copied.push(value) } } })
    click(document, '.lm-pkg-install__manager[data-manager-value="1"]')
    click(document, '[data-pkg-cooldown="toggle"]')
    click(document, '.lm-install__headend [data-manager="1"] [data-cooldown-variant="days"] [data-copy-key]')
    await Promise.resolve()
    expect(copied).toEqual(['uv add \\\n    --exclude-newer P7D \\\n    --exclude-newer-package libtmux=2099-01-01 \\\n    libtmux'])
  })

  it('copies a Package Manager Console command without its prompt', async () => {
    const { window, document } = await renderPackage({ ports: ['csharp'] }, { scripts: true })
    const copied: string[] = []
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async (value: string) => { copied.push(value) } } })
    click(document, '.lm-install__headend [data-manager="1"] [data-copy-key]')
    await Promise.resolve()
    expect(copied).toHaveLength(1)
    expect(copied[0]).toMatch(/^NuGet\\Install-Package LibTmux/)
  })
})

/** The MCP installer, rendered with its real parts; each body is split into one `line` span per line, as Shiki does. */
async function renderMcp(port: string, options: { saved?: Record<string, string>; scripts?: boolean } = {}) {
  const lines = (code: string) => code.replace(/<COOLDOWN_[A-Z]+>/g, '7').split('\n').map((line) => `<span class="line">${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>`).join('\n')
  const template = await loadAstroTemplate('components/widgets/McpInstall.astro', {
    real: ['InstallCode', 'InstallCooldown', 'InstallFacts', 'InstallWhere'].map((name) => `components/widgets/${name}.astro`),
    modules: { '../../lib/highlight': { highlightWithCooldownSlots: async (code: string) => lines(code), highlightInline: async (code: string) => lines(code) } },
  })
  const window = openWindow()
  for (const [key, value] of Object.entries(options.saved ?? {})) window.localStorage.setItem(key, value)
  window.document.body.innerHTML = await renderAstroTemplate(template, { props: { port } })
  if (options.scripts) {
    window.eval(readFileSync(new URL('mcp-install.js', widgets), 'utf8'))
    hydrate(window, new URL('InstallCode.astro', widgets))
  }
  return { window, document: window.document as unknown as Document }
}

describe('the MCP installer draws one code surface', () => {
  const key = (client: string, method: string, scope: string, cooldown: string) => `[data-client="${client}"][data-method="${method}"][data-scope="${scope}"][data-cooldown="${cooldown}"]`
  const body = (document: Document, selector: string) => document.querySelector(`.lm-install__body .lm-mcp-install__panel${selector}`)!

  it('puts the client tabs, where the code goes and one Copy in the header', async () => {
    const { document } = await renderMcp('py')
    const head = document.querySelector('.lm-install__head')!
    expect([...head.querySelectorAll('.lm-install__tabs [role="tab"]')].map(text)).toEqual(['Claude Code', 'Claude Desktop', 'Codex CLI', 'Gemini CLI', 'Cursor', 'Grok CLI', 'Antigravity', 'opencode'])
    const where = (selector: string) => head.querySelector(`.lm-install__headend .lm-mcp-install__panel${selector}`)!
    expect(text(where(key('claude-code', 'uvx', 'local', 'off')).querySelector('.lm-install__target'))).toBe('Terminal')
    expect(text(where(key('cursor', 'uvx', 'global', 'off')).querySelector('.lm-install__target'))).toBe('~/.cursor/mcp.json')
    expect(where(key('cursor', 'uvx', 'global', 'off')).querySelector('[data-copy-key]')?.getAttribute('data-copy-key')).toBe('cursor/uvx/global/off')
    // A long file target cuts its folder, never its file name.
    const long = where(key('antigravity', 'uvx', 'global', 'off')).querySelector('.lm-install__target')!
    expect(text(long.querySelector('.lm-install__dir'))).toBe('~/.gemini/config/')
    expect(text(long.querySelector('.lm-install__base'))).toBe('mcp_config.json')
  })

  it('puts the package facts, Run with and Scope in the bar, and the cooldown at its right edge', async () => {
    const { document } = await renderMcp('py')
    const bar = document.querySelector('.lm-install__bar')!
    expect([...bar.children].map((child) => child.className)).toEqual(['lm-install__facts', 'lm-install__opts', 'lm-install__cd'])
    expect(text(bar.querySelector('.lm-install__facts code'))).toBe('libtmux-mcp')
    expect([...bar.querySelectorAll('[data-tab-kind="method"]')].map((tab) => text(tab).replace(' (no cooldown)', ''))).toEqual(['uvx', 'pipx', 'pip install'])
    expect([...bar.querySelectorAll('[data-scope-client="claude-code"] [data-tab-kind="scope"]')].map(text)).toEqual(['Local', 'User', 'Project'])
    expect(bar.querySelector('[data-mcp-cooldown="toggle"]')?.getAttribute('aria-pressed')).toBe('false')
  })

  it('carries a caution dot on the method the cooldown cannot reach', async () => {
    const { document } = await renderMcp('py')
    const method = (id: string) => document.querySelector(`.lm-install__bar [data-tab-kind="method"][data-tab-value="${id}"]`)!
    expect(method('pipx').hasAttribute('data-no-days')).toBe(true)
    expect(method('pip').hasAttribute('data-no-bypass')).toBe(true)
    expect(method('uvx').hasAttribute('data-no-days')).toBe(false)
  })

  it('draws no cooldown control for a port whose toolchain has none', async () => {
    const { document } = await renderMcp('go')
    expect(document.querySelector('[data-mcp-cooldown]')).toBeNull()
    expect(document.querySelector('.lm-install__cd')).toBeNull()
  })

  it('attaches the server to install as a First strip with its own Copy, above the command', async () => {
    const { document } = await renderMcp('py')
    const panel = body(document, key('claude-code', 'pip', 'local', 'off'))
    const first = panel.querySelector('.lm-mcp-install__code--strip')!
    expect(text(first.querySelector('.lm-install__k'))).toBe('First')
    expect(text(first.querySelector('code'))).toBe('$ pip install --user --upgrade libtmux libtmux-mcp')
    expect(first.querySelector('[data-action="copy"]')).not.toBeNull()
    expect(first.compareDocumentPosition(panel.querySelector('.lm-mcp-install__code--plain')!) & 4).toBeTruthy()
  })

  it('marks a path the reader replaces and copies it as written', async () => {
    const { document } = await renderMcp('julia')
    const code = body(document, key('claude-code', 'pkg', 'local', 'off')).querySelector('.lm-mcp-install__code--plain code')!
    const slots = [...code.querySelectorAll('.lm-install__slot')].map(text)
    expect(slots).toEqual(['/absolute/path/to/project/bin/libtmux-mcp', '/absolute/path/to/tmux.sock'])
    expect(text(code)).toContain('/absolute/path/to/project/bin/libtmux-mcp')
  })

  it('draws the prompt once', async () => {
    const { document } = await renderMcp('py')
    const shown = text(body(document, '[data-default]').querySelector('.lm-mcp-install__code--plain code'))
    expect(shown).toMatch(/^\$ claude mcp add tmux/)
    expect(shown).not.toMatch(/\$ \$/)
  })

  it('says where a command writes, and keeps one prompt', async () => {
    const { document } = await renderMcp('py')
    const note = document.querySelector(`.lm-install__notes .lm-mcp-install__panel${key('claude-code', 'uvx', 'user', 'off')}`)!
    expect(text(note)).toContain('Writes ~/.claude.json (all projects).')
    expect(text(body(document, key('claude-code', 'uvx', 'user', 'off')).querySelector('code'))).toBe('$ claude mcp add tmux --scope user -- uvx libtmux-mcp')
  })

  it('draws the code a note marks with backticks as code', async () => {
    const { document } = await renderMcp('ts')
    const note = document.querySelector(`.lm-install__notes .lm-mcp-install__panel${key('claude-code', 'global', 'local', 'off')}`)!
    expect([...note.querySelectorAll('code')].map(text)).toEqual(['libtmux-mcp'])
    expect(note.textContent).not.toContain('`')
  })

  it('says the cooldown in a strip, and marks the lines it adds in the command or its prerequisite', async () => {
    const { document } = await renderMcp('py')
    const uvx = body(document, key('claude-code', 'uvx', 'local', 'days'))
    expect(uvx.querySelector('.lm-install__cooldown')?.getAttribute('data-tone')).toBe('on')
    expect(uvx.querySelectorAll('.line.is-added').length).toBeGreaterThan(0)
    const ts = (await renderMcp('ts')).document
    const global = body(ts, key('claude-code', 'global', 'local', 'days'))
    expect([...global.querySelectorAll('.lm-mcp-install__code--strip .line.is-added')].map(text)).toEqual([
      '--min-release-age=7 \\',
      '--min-release-age-exclude=@libtmux/mcp \\',
      '--min-release-age-exclude=libtmux \\',
    ])
  })

  it('turns caution for a method that cannot take one, gives the reason and offers the one that can', async () => {
    const { document } = await renderMcp('py')
    const pipx = body(document, key('claude-code', 'pipx', 'local', 'days')).querySelector('.lm-install__cooldown')!
    expect(pipx.getAttribute('data-tone')).toBe('caution')
    expect(text(pipx.querySelector('.lm-install__cooldown-body'))).toBe('pipx has no per-package cooldown override, so this snippet runs without cooldown enforcement. Use uvx')
    expect(pipx.querySelector('[data-cooldown-action="alt"]')?.getAttribute('data-cooldown-alt')).toBe('uvx')
    const ts = (await renderMcp('ts')).document
    expect(text(body(ts, key('claude-code', 'npx', 'local', 'days')).querySelector('[data-cooldown-action="alt"]'))).toBe('Use Global install')
    expect(body(document, key('claude-code', 'pipx', 'local', 'days')).querySelectorAll('.line.is-added')).toHaveLength(0)
  })
})

describe('driving the MCP installer', () => {
  const store = (window: Window, name: string) => window.localStorage.getItem(`libtmux-docs.mcp-install.${name}`)
  const click = (document: Document, selector: string) => (document.querySelector(selector) as HTMLElement).click()

  it('switches the client, the method and the scope from the tabs, and remembers them', async () => {
    const { window, document } = await renderMcp('py', { scripts: true })
    click(document, '.lm-install__tabs [data-tab-kind="client"][data-tab-value="cursor"]')
    expect(document.documentElement.getAttribute('data-mcp-install-client')).toBe('cursor')
    expect(document.documentElement.getAttribute('data-mcp-install-scope')).toBe('project')
    click(document, '.lm-install__bar [data-tab-kind="scope"][data-tab-client="cursor"][data-tab-value="global"]')
    expect(document.documentElement.getAttribute('data-mcp-install-scope')).toBe('global')
    click(document, '.lm-install__bar [data-tab-kind="method"][data-tab-value="pipx"]')
    expect(store(window, 'client')).toBe('cursor')
    expect(store(window, 'scope.cursor')).toBe('global')
    expect(store(window, 'method.py')).toBe('pipx')
  })

  it('turns the cooldown on from the toggle and back off from the strip, for every installer', async () => {
    const { window, document } = await renderMcp('py', { scripts: true })
    click(document, '[data-mcp-cooldown="toggle"]')
    expect(document.documentElement.getAttribute('data-mcp-install-cooldown-enabled')).toBe('1')
    expect(document.querySelector('[data-mcp-cooldown="toggle"]')!.getAttribute('aria-pressed')).toBe('true')
    expect(store(window, 'cooldown.enabled')).toBe('1')
    click(document, '[data-cooldown-family="mcp"] [data-cooldown-action="bypass"]')
    expect(store(window, 'cooldown.type')).toBe('bypass')
    click(document, '[data-cooldown-family="mcp"] [data-cooldown-action="days-mode"]')
    expect(store(window, 'cooldown.type')).toBe('days')
    click(document, '[data-cooldown-family="mcp"] [data-cooldown-action="remove"]')
    expect(store(window, 'cooldown.enabled')).toBe('0')
    expect(document.querySelector('[data-mcp-cooldown="toggle"]')!.getAttribute('aria-pressed')).toBe('false')
  })

  it('writes the day count into the command as an ISO duration', async () => {
    const { window, document } = await renderMcp('py', { scripts: true })
    const input = document.querySelector<HTMLInputElement>('[data-cooldown-family="mcp"] [data-cooldown-action="days"]')!
    input.value = '14'
    input.dispatchEvent(new window.Event('change', { bubbles: true }) as unknown as Event)
    expect(store(window, 'cooldown.days')).toBe('14')
    expect(store(window, 'cooldown.enabled')).toBe('1')
  })

  it('moves to the method that can, from the strip that says the method cannot', async () => {
    const { window, document } = await renderMcp('py', { scripts: true })
    click(document, '.lm-install__bar [data-tab-kind="method"][data-tab-value="pipx"]')
    click(document, '[data-mcp-cooldown="toggle"]')
    click(document, '.lm-install__body .lm-mcp-install__panel[data-client="claude-code"][data-method="pipx"][data-scope="local"][data-cooldown="days"] [data-cooldown-action="alt"]')
    expect(document.documentElement.getAttribute('data-mcp-install-method')).toBe('uvx')
    expect(store(window, 'method.py')).toBe('uvx')
  })

  it('copies the command as written, without its prompt, from the header', async () => {
    const { window, document } = await renderMcp('julia', { scripts: true })
    const copied: string[] = []
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async (value: string) => { copied.push(value) } } })
    click(document, '.lm-install__headend [data-client="claude-code"][data-method="pkg"][data-scope="local"][data-cooldown="off"] [data-copy-key]')
    await Promise.resolve()
    expect(copied).toEqual(['claude mcp add tmux \\\n    -- /absolute/path/to/project/bin/libtmux-mcp \\\n        --socket /absolute/path/to/tmux.sock'])
  })
})
