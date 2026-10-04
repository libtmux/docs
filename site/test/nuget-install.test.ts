import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { experimental_AstroContainer } from 'astro/container'
import { Window, type HTMLButtonElement } from 'happy-dom'
import ts from 'typescript'
import { PORT_BY_SLUG, PORTS } from '../src/lib/ports'
import { installsFor, nugetInstallSelection, REGISTRY } from '../src/lib/registry'
import { pickerPaintRules } from '../src/lib/picker-paint'
import { highlightInline, highlightWithCooldownSlots } from '../src/lib/highlight'
import csharp from '../src/data/api/csharp.json'
import fsharp from '../src/data/api/fsharp.json'
import { HOME_PORT_PREVIEW_EVENT } from '../src/lib/home-hover-preview'

const models = { csharp, fsharp }
const windows: Window[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const win of windows.splice(0)) await win.happyDOM.abort()
})
const forms = (slug: string, env: Record<string, string> = {}) => {
  const port = PORT_BY_SLUG[slug]
  return installsFor(port, nugetInstallSelection(port, models[slug as keyof typeof models]?.sources, env))
}

describe('NuGet installation recipes', () => {
  it.each(['csharp', 'fsharp'])('offers each applicable method for %s with its own source version', (slug) => {
    const port = PORT_BY_SLUG[slug],
      commands = forms(slug)
    expect(commands.map((cmd) => cmd.label)).toEqual([
      '.NET CLI',
      'PMC',
      'PackageReference',
      'CPM',
      'Paket CLI',
      'Script & Interactive',
      'File-Based Apps',
      'Cake',
    ])
    const version = models[slug as keyof typeof models].sources.find(
      (source) => source.package === port.packageName,
    )!.version
    expect(commands[2].code).toContain(`Version="${version}"`)
    expect(commands[1].code).toBe(`NuGet\\Install-Package ${port.packageName} -Version ${version}`)
    expect(commands.every((cmd) => cmd.code.includes(port.packageName))).toBe(true)
    expect(JSON.stringify(commands)).not.toMatch(/#tool|LibTmux\.Workspace|LibTmux\.Mcp/)
    expect(commands[7].code).toContain('&loaddependencies=true')
    expect(commands[6].note).toContain('C# file-based apps require the .NET 10 SDK')
    expect(commands[5].note).toContain('F# .fsx')
    expect(commands[3].additionalBlocks?.[0].code).toBe(`<PackageReference Include="${port.packageName}" />`)
    expect(commands[3].code).toContain('<ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>')
    expect(commands[0].code).toBe(
      slug === 'csharp'
        ? 'dotnet package add LibTmux --prerelease'
        : `dotnet package add LibTmux.FSharp --version ${version}`,
    )
  })

  it.each(['csharp', 'fsharp'])(
    'gives the selected historical %s release priority over the model and registry',
    (slug) => {
      const commands = forms(slug, { LIBTMUX_DOCS_PORT: slug, LIBTMUX_DOCS_VERSION: 'v0.0.0-alpha.12' })
      expect(commands[0].code).toContain('--version 0.0.0-alpha.12')
      for (const command of commands) expect(command.code).toContain('0.0.0-alpha.12')
      expect(commands[3].additionalBlocks?.[0].code).not.toContain('Version=')
      expect(JSON.stringify(commands.map(({ code, additionalBlocks }) => ({ code, additionalBlocks })))).not.toContain(
        '{version}',
      )
    },
  )

  it('does not borrow a selected C# release for F# or mistake a maintenance branch for a package version', () => {
    for (const env of [
      { LIBTMUX_DOCS_PORT: 'csharp', LIBTMUX_DOCS_VERSION: 'v0.0.0-alpha.12' },
      { LIBTMUX_DOCS_PORT: 'fsharp', LIBTMUX_DOCS_VERSION: 'v0.x' },
    ]) {
      expect(forms('fsharp', env)[0].code).toEqual(forms('fsharp')[0].code)
    }
  })

  it('fills additional fragments when a recipe needs its version there', () => {
    const port = {
      ...PORT_BY_SLUG.fsharp,
      installs: [{ label: 'CPM', code: 'main', lang: 'xml', additionalBlocks: [{ code: '{version}', lang: 'xml' }] }],
    }
    expect(installsFor(port, { version: '1.2.3' })[0].additionalBlocks?.[0].code).toBe('1.2.3')
  })
})

const astroRequire = createRequire(realpathSync(new URL('../node_modules/astro/package.json', import.meta.url)))
const packageFile = new URL('../src/components/widgets/PackageInstall.astro', import.meta.url)
const copyFile = new URL('../src/components/widgets/InstallCode.astro', import.meta.url)
const bindings = {
  registry: { installsFor, nugetInstallSelection },
  models: { API_MODELS: models },
  highlight: { highlightInline, highlightWithCooldownSlots },
  ports: { PORTS },
}
// The actual source functions stay in the test module; only collection loading and
// unused example rendering are omitted from this focused component fixture.
Object.assign(globalThis, { __nugetInstallBindings: bindings })
const exported = (name: keyof typeof bindings) =>
  `data:text/javascript,export const {${Object.keys(bindings[name]).join(',')}} = globalThis.__nugetInstallBindings.${name}`
let componentPromise:
  | Promise<Parameters<Awaited<ReturnType<typeof experimental_AstroContainer.create>>['renderToString']>[0]>
  | undefined
async function component() {
  return (componentPromise ??= (async () => {
    const { transform } = await import(astroRequire.resolve('@astrojs/compiler-rs'))
    async function compile(file: URL, imports: Record<string, string>) {
      const source = readFileSync(file, 'utf8')
        .replace(/<script>[\s\S]*?<\/script>/g, '')
        .replace("import './package-install.css'", '')
      const result = await transform(source, {
        filename: file.pathname,
        internalURL: 'astro/compiler-runtime',
        resultScopedSlot: true,
        resolvePath: (specifier: string) => specifier,
      })
      expect(result.diagnostics.filter((item: { severity: string }) => item.severity === 'error')).toEqual([])
      let code = result.code.replaceAll(
        '"astro/compiler-runtime"',
        JSON.stringify(pathToFileURL(astroRequire.resolve('astro/compiler-runtime')).href),
      )
      for (const [specifier, url] of Object.entries(imports))
        code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(url))
      return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
    }
    const copy = await compile(copyFile, {})
    const url = await compile(packageFile, {
      './InstallCode.astro': copy,
      '../../lib/registry': exported('registry'),
      '../../lib/api-models': exported('models'),
      '../../lib/highlight': exported('highlight'),
      '../../lib/ports': `data:text/javascript,export const {PORTS}=globalThis.__nugetInstallBindings.ports;export const portHomeUrl=()=>'',referenceUrl=()=>''`,
      '../../lib/versions': 'data:text/javascript,export const defaultVersionFor=()=>"latest"',
      '../../lib/install-matrix': 'data:text/javascript,export const DEFAULT_COOLDOWN_DAYS=3',
      'astro-expressive-code/components': 'data:text/javascript,export const Code=()=>""',
    })
    return (await import(/* @vite-ignore */ url)).default
  })())
}
async function render(slug: string, saved?: string) {
  const win = new Window({ url: `https://libtmux.org/en/${slug}/latest/` })
  windows.push(win)
  if (saved) {
    win.localStorage.setItem(`libtmux-docs.package-install.manager.${slug}`, saved)
    win.document.documentElement.setAttribute(`data-pkg-manager-${slug}`, saved)
  }
  const container = await experimental_AstroContainer.create()
  win.document.body.innerHTML = await container.renderToString(await component(), { props: { ports: [slug] } })
  const style = win.document.createElement('style')
  style.textContent =
    readFileSync(new URL('../src/components/widgets/package-install.css', import.meta.url), 'utf8') + pickerPaintRules()
  win.document.head.append(style)
  return win
}
function hydrate(win: Window, file: URL) {
  const script = readFileSync(file, 'utf8')
    .match(/<script>([\s\S]*?)<\/script>/)![1]
    .replace(
      /import \{ HOME_PORT_PREVIEW_EVENT \}[^\n]+/,
      `const HOME_PORT_PREVIEW_EVENT = ${JSON.stringify(HOME_PORT_PREVIEW_EVENT)}`,
    )
  win.eval(
    ts.transpileModule(`(() => {${script}})()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
  )
  win.document.dispatchEvent(new win.Event('astro:page-load'))
}

describe('NuGet widget rendering and copied fragments', () => {
  it.each(['csharp', 'fsharp'])('paints the saved CPM choice and copies each %s fragment separately', async (slug) => {
    const win = await render(slug, '3'),
      doc = win.document
    const panels = [...doc.querySelectorAll('.lm-pkg-install__cmd')]
    expect(
      panels
        .filter((panel) => win.getComputedStyle(panel).display !== 'none')
        .map((panel) => panel.getAttribute('data-manager')),
    ).toEqual(['3'])
    const cpm = panels[3],
      blocks = [...cpm.querySelectorAll('[data-install-code]')]
    expect(blocks).toHaveLength(2)
    expect(cpm.querySelectorAll('code span[style]').length).toBeGreaterThan(5)
    expect(blocks[0].querySelector('button')?.getAttribute('aria-label')).toBe('Copy Directory.Packages.props')
    const copied: string[] = []
    Object.defineProperty(win.navigator, 'clipboard', {
      value: {
        writeText: async (text: string) => {
          copied.push(text)
        },
      },
    })
    hydrate(win, packageFile)
    hydrate(win, copyFile)
    for (const block of blocks) block.querySelector('button')!.click()
    await Promise.resolve()
    expect(copied).toEqual([forms(slug)[3].code, forms(slug)[3].additionalBlocks![0].code])
    expect(copied[0]).not.toContain('$ ')
    const active = doc.querySelector('.lm-pkg-install__manager[aria-selected="true"]')!
    expect(active.getAttribute('data-manager-value')).toBe('3')
    active.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(
      doc.querySelector('.lm-pkg-install__manager[aria-selected="true"]')?.getAttribute('data-manager-value'),
    ).toBe('4')
    expect(doc.activeElement?.getAttribute('data-manager-value')).toBe('4')
  })

  it.each(['csharp', 'fsharp'])('copies every %s method without prompts or sibling fragments', async (slug) => {
    const win = await render(slug),
      copied: string[] = []
    Object.defineProperty(win.navigator, 'clipboard', {
      value: {
        writeText: async (text: string) => {
          copied.push(text)
        },
      },
    })
    hydrate(win, packageFile)
    hydrate(win, copyFile)
    const commands = forms(slug)
    for (const [index, command] of commands.entries()) {
      win.document.querySelector<HTMLButtonElement>(`.lm-pkg-install__manager[data-manager-value="${index}"]`)!.click()
      const panel = win.document.querySelector(`.lm-pkg-install__cmd[data-manager="${index}"]`)!
      expect(win.getComputedStyle(panel).display).toBe('block')
      for (const button of panel.querySelectorAll<HTMLButtonElement>('button[data-action="copy"]')) button.click()
      await Promise.resolve()
      expect(copied.splice(0)).toEqual([command.code, ...(command.additionalBlocks ?? []).map((block) => block.code)])
    }
  })

  it('keeps the no-script default visible and highlights C# directives at render time', async () => {
    const win = await render('csharp')
    expect(
      [...win.document.querySelectorAll('.lm-pkg-install__cmd')].filter(
        (panel) => win.getComputedStyle(panel).display !== 'none',
      ),
    ).toHaveLength(1)
    expect(win.document.querySelector('[data-manager="6"] code span[style]')).not.toBeNull()
  })

  it('does not hide Source fallback when storage remembers an unavailable manager', async () => {
    const originalEntry = REGISTRY.ports.fsharp,
      originalSources = fsharp.sources
    try {
      REGISTRY.ports.fsharp = { status: 'unpublished', version: null, stable: null, tag: 'v0.0.0-alpha.18' }
      fsharp.sources = []
      const win = await render('fsharp', '3')
      const source = win.document.querySelector('.lm-pkg-install__cmd')!
      expect(source.textContent).toContain('dotnet add reference')
      expect(win.getComputedStyle(source).display).toBe('block')
      hydrate(win, packageFile)
      expect(win.getComputedStyle(source).display).toBe('block')
    } finally {
      REGISTRY.ports.fsharp = originalEntry
      fsharp.sources = originalSources
    }
  })
})
