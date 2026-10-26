import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { experimental_AstroContainer } from 'astro/container'
import type { Window, HTMLButtonElement } from 'happy-dom'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildLocale, localeSourcePath } from '../src/i18n/locales'
import { CONTRIBUTE_BRANCH, CONTRIBUTE_REPO, repoPath } from '../src/i18n/contribute'
import { markdownPath } from '../src/lib/markdown-twins'
import { pageBrand, PORT_BY_SLUG, PORTS, portSourceUrl } from '../src/lib/ports'
import { withPortRoot, withRoot } from '../src/lib/site-root'
import { buildTarget } from '../src/lib/versions'
import { renderedTargets } from '../src/lib/inventory-targets'
import { tmuxInventoryVersion } from '../src/lib/inventory-links'
import { targetKey } from '@libtmux/api-model'

const astroRequire = createRequire(realpathSync(new URL('../node_modules/astro/package.json', import.meta.url)))
const noticeSource = readFileSync(new URL('../src/components/PrereleaseNotice.astro', import.meta.url), 'utf8')
const windows: Window[] = []
let layout: Parameters<Awaited<ReturnType<typeof experimental_AstroContainer.create>>['renderToString']>[0]

beforeAll(async () => {
  const { transform } = await import(astroRequire.resolve('@astrojs/compiler-rs'))
  async function compile(source: string, filename: string, imports: Record<string, string> = {}) {
    const result = await transform(source.replace(/<script>[\s\S]*?<\/script>/g, ''), {
      filename, internalURL: 'astro/compiler-runtime', resultScopedSlot: true,
      resolvePath: (specifier: string) => specifier,
    })
    expect(result.diagnostics.filter((item: { severity: string }) => item.severity === 'error')).toEqual([])
    let code = result.code.replaceAll('"astro/compiler-runtime"', JSON.stringify(pathToFileURL(astroRequire.resolve('astro/compiler-runtime')).href))
    for (const [specifier, href] of Object.entries(imports)) code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(href))
    return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  }
  const stub = await compile('<slot />', 'UnrelatedShellChild.astro')
  vi.stubGlobal('__prereleaseChild', (await import(/* @vite-ignore */ stub)).default)
  const helpers = {
    buildLocale, localeSourcePath, CONTRIBUTE_BRANCH, CONTRIBUTE_REPO, repoPath,
    markdownPath, pageBrand, PORT_BY_SLUG, portSourceUrl, withPortRoot, withRoot, buildTarget, tmuxInventoryVersion,
  }
  vi.stubGlobal('__prereleaseHelpers', helpers)
  const helperModule = `data:text/javascript,export const {${Object.keys(helpers).join(',')}}=globalThis.__prereleaseHelpers`
  const file = new URL('../src/layouts/BaseLayout.astro', import.meta.url)
  const source = readFileSync(file, 'utf8')
  const imports = Object.fromEntries([...source.matchAll(/from '([^']+)'/g)].map(([, name]) => [name!, helperModule]))
  for (const name of Object.keys(imports)) if (name.endsWith('.astro')) imports[name] = stub
  imports['astro:transitions'] = 'data:text/javascript,export const ClientRouter=globalThis.__prereleaseChild'
  imports['../components/PrereleaseNotice.astro'] = await compile(noticeSource, 'PrereleaseNotice.astro')
  imports['../components/SiteFooter.astro'] = await compile('<footer data-compact={String(Boolean(Astro.props.compact))} data-github={Astro.props.githubUrl} />', 'SiteFooterProbe.astro')
  // Only unrelated child components are stubbed; ownership and notice markup run unchanged.
  layout = (await import(/* @vite-ignore */ await compile(source, file.pathname, imports))).default
})

afterEach(async () => {
  for (const win of windows.splice(0)) await win.happyDOM.abort()
  vi.unstubAllEnvs()
})
afterAll(() => vi.unstubAllGlobals())

async function render(path: string, pagePath?: string, portSlug?: string, bare = false, repository?: string, buildPort = '') {
  const url = new URL(path, 'https://libtmux.org')
  const prefix = /^(\/pr-\d+)?\/(en|ja)\//.exec(url.pathname)
  vi.stubEnv('LIBTMUX_DOCS_BASE', prefix?.[0] ?? '/')
  vi.stubEnv('LIBTMUX_DOCS_PORT', buildPort)
  vi.stubEnv('LIBTMUX_DOCS_LOCALE', prefix?.[2] ?? 'en')
  const container = await experimental_AstroContainer.create()
  return container.renderToString(layout, {
    request: new Request(url), props: { title: 'Documentation', pagePath, portSlug, bare, repository,
      locale: prefix?.[2] ?? 'en', pageSource: { repo: 'libtmux/docs', ref: 'main', path: 'site/src/pages/index.astro' } },
    slots: { default: '<main>Page content</main>' },
  })
}

describe('bare pages', () => {
  it('keep the footer, reduced to its page-source line, so every page names its source', async () => {
    expect(await render('/en/demo/sidebar/preview/py/', 'demo/sidebar/preview/py', 'py', true)).toContain('<footer data-compact="true"')
    expect(await render('/en/py/latest/reference/server/', 'reference/server', 'py')).toContain('<footer data-compact="false"')
  })

  it('point the GitHub icon at the repository they name, even for a language with a source directory', async () => {
    const preview = (repository?: string) => render('/en/demo/sidebar/preview/kotlin/', 'demo/sidebar/preview/kotlin', 'kotlin', true, repository)
    expect(await preview('libtmux/docs')).toContain('data-github="https://github.com/libtmux/docs/"')
    expect(await preview()).toMatch(/data-github="https:\/\/github\.com\/[^"]+\/tree\/[^"]+\/libtmux-kotlin"/)
  })
})

describe('prerelease notice ownership', () => {
  it('assigns versioned tmux manuals, catalogs and C pages to their release inventory', async () => {
    for (const version of ['latest', '3.7c', '3.2a']) for (const section of ['manual', 'catalog', 'reference']) {
      const page = `tmux/${version}/${section}/entry`
      for (const pagePath of [page, undefined]) {
        const href = `/pr-42/en/${page}/`
        const targets = renderedTargets(await render(href, pagePath), href)
        expect(targets).toMatchObject([{ scope: `tmux@${version}`, version, category: 'doc', identity: page }])
        if (section === 'catalog') expect(targets[0].aliases).toContain(targetKey({ scope: 'site', product: 'core', category: 'doc', identity: page }))
      }
    }
  })
  it('exports the selected port only inside its version mount', async () => {
    for (const path of ['/en/', '/pr-42/en/', '/py/', '/py/latestish/']) {
      const shared = await render(path, '', 'py', false, undefined, 'py')
      expect(renderedTargets(shared, path), path).toEqual([])
    }
    const port = await render('/py/latest/', '', 'py', false, undefined, 'py')
    expect(renderedTargets(port, '/py/latest/')).toMatchObject([
      { scope: 'py', version: 'latest', category: 'doc', identity: 'index', href: '/py/latest/' },
    ])
    const root = await render('/en/', '')
    expect(renderedTargets(root, '/en/')).toMatchObject([
      { scope: 'site', category: 'doc', identity: 'index', href: '/en/' },
    ])
  })
  it('omits the library notice from every tmux area before JavaScript runs', async () => {
    for (const prefix of ['/en/', '/ja/', '/pr-42/en/', '/pr-42/ja/']) {
      for (const page of ['tmux', 'tmux/', 'tmux/guides', 'tmux/topics/environment',
        'tmux/concepts/servers', 'tmux/examples/capture', 'tmux/latest/manual',
        'tmux/3.2a/manual/full/', 'tmux/latest/reference/server', 'tmux/3.7c/reference/']) {
        for (const pagePath of [page, undefined]) {
          const html = await render(`${prefix}${page}?q=server#members`, pagePath)
          expect(html, `${prefix}${page} (${pagePath ?? 'route fallback'})`).not.toContain('data-prerelease-notice')
          expect(html).not.toContain('prerelease-notice__inner')
          expect(html).toContain('<main>Page content</main>')
        }
      }
    }
  })

  it('keeps library, product, landing and similar-name notices', async () => {
    for (const page of ['', 'tmuxp', 'tmuxp/guides', 'other/tmux', 'guides/tmux', 'workspace', 'mcp']) {
      expect(await render(`/en/${page}`, page)).toContain('data-prerelease-notice')
    }
    for (const port of PORTS) for (const page of ['reference/server', 'workspace', 'mcp', 'tmux/guide']) {
      expect(await render(`/en/${port.slug}/latest/${page}`, page, port.slug)).toContain('data-prerelease-notice')
    }
    expect(await render('/en/', '')).toContain('prerelease-notice--centered')
    expect(await render('/en/ts/latest/reference/server/', 'reference/server', 'ts', true)).not.toContain('data-prerelease-notice')
  })

  it('binds dismissal after swaps through a tmux page and remembers the dismissal', async () => {
    const [{ Window }, { default: ts }] = await Promise.all([import('happy-dom'), import('typescript')])
    const win = new Window()
    windows.push(win)
    const library = await render('/en/ts/latest/reference/server/', 'reference/server', 'ts')
    const tmux = await render('/en/tmux/', 'tmux')
    win.document.body.innerHTML = library
    const script = /<script>([\s\S]*?)<\/script>/.exec(noticeSource)?.[1]
    if (!script) throw new Error('Prerelease dismissal script is missing')
    win.eval(ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)
    const first = win.document.querySelector<HTMLButtonElement>('[data-prerelease-dismiss]')!
    expect(first.getAttribute('aria-label')).toBe('Dismiss the prerelease notice')
    expect(first.dataset.bound).toBe('yes')
    win.document.body.innerHTML = tmux
    win.document.dispatchEvent(new win.Event('astro:after-swap'))
    expect(win.document.querySelector('[data-prerelease-notice]')).toBeNull()
    win.document.body.innerHTML = library
    win.document.dispatchEvent(new win.Event('astro:after-swap'))
    const next = win.document.querySelector<HTMLButtonElement>('[data-prerelease-dismiss]')!
    expect(next.dataset.bound).toBe('yes')
    next.click()
    expect(win.document.documentElement.getAttribute('data-prerelease')).toBe('dismissed')
    expect(win.localStorage.getItem('libtmux-docs.prerelease-notice')).toBe('dismissed')
  })
})
