import { Window } from 'happy-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { buildPanels, markPlaceholders, SERVERS } from '../src/lib/install-matrix'
import { addedLines, channelForms, markAddedLines, promptFor, targetParts, withPrompt } from '../src/lib/install-surface'
import { formTarget, PORTS, type InstallCommand } from '../src/lib/ports'
import { installsFor } from '../src/lib/registry'
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
