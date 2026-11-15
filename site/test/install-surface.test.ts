import { Window } from 'happy-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { buildPanels, SERVERS } from '../src/lib/install-matrix'
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
