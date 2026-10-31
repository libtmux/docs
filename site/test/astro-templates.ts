import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { experimental_AstroContainer } from 'astro/container'
import { expect } from 'vitest'

/**
 * Render real `.astro` templates without a Vite or Astro build.
 *
 * The compiler turns each template into JavaScript. Local helper imports bind
 * to the modules vitest has already loaded, so a template and its test share
 * one `PORT_BY_SLUG`. Child components render only their slot unless the
 * caller lists them in `real` or supplies replacement source in `stubs`.
 */
const SOURCE = new URL('../src/', import.meta.url)
const astroRequire = createRequire(realpathSync(new URL('../node_modules/astro/package.json', import.meta.url)))
const RUNTIME = pathToFileURL(astroRequire.resolve('astro/compiler-runtime')).href

type Exports = Record<string, unknown>
type Registry = Map<string, Exports>
const slot = Symbol.for('libtmux.astro-templates')
const modules: Registry = ((globalThis as Record<symbol, Registry>)[slot] ??= new Map())

export interface AstroTemplateOptions {
  /** Paths below `site/src` compiled from source. The entry template is always real. */
  real?: readonly string[]
  /** Replacement Astro source, keyed by path below `site/src`. */
  stubs?: Readonly<Record<string, string>>
  /** Replacement exports for a helper import, keyed by its specifier. */
  modules?: Readonly<Record<string, Exports>>
  /** Keep `<script is:inline>` elements, which render in place; bundled scripts are always dropped. */
  inlineScripts?: boolean
}

let loads = 0

/**
 * Compile `entry`, a path below `site/src`, and return its default export.
 *
 * Each call evaluates its own module graph: Node caches a data URL by its
 * text, so a numbered comment keeps a second load, after `vi.resetModules()`
 * and a changed environment, from reusing the first one's helper bindings.
 */
export async function loadAstroTemplate(entry: string, options: AstroTemplateOptions = {}) {
  const load = ++loads
  const dataModule = (code: string) => `data:text/javascript;base64,${Buffer.from(`${code}\n//# load ${load}`).toString('base64')}`
  const { transform } = await import(astroRequire.resolve('@astrojs/compiler-rs'))
  const real = new Set([entry, ...(options.real ?? [])])
  const compiled = new Map<string, string>()

  async function compile(file: URL, source = readFileSync(file, 'utf8')): Promise<string> {
    const cached = compiled.get(file.href)
    if (cached) return cached
    const result = await transform(
      source.replace(options.inlineScripts ? /<script\b(?![^>]*\bis:inline\b)[^>]*>[\s\S]*?<\/script>/g : /<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/^import ['"][^'"\n]+\.css['"];?\s*$/gm, ''),
      { filename: file.pathname, internalURL: 'astro/compiler-runtime', resultScopedSlot: true,
        scopedStyleStrategy: 'attribute', resolvePath: (specifier: string) => specifier },
    )
    expect(result.diagnostics.filter((item: { severity: string }) => item.severity === 'error')).toEqual([])
    let code = result.code.replaceAll('"astro/compiler-runtime"', JSON.stringify(RUNTIME))
      .replace(/^import ["'][^"'\n]+\?astro&type=style[^"'\n]+["'];?\s*$/gm, '')
    for (const specifier of new Set([...code.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((match) => match[1]!))) {
      if (specifier === RUNTIME) continue
      code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(await bind(file, specifier)))
    }
    const url = dataModule(`${code}\n//# sourceURL=${file.pathname}`)
    compiled.set(file.href, url)
    return url
  }

  async function bind(importer: URL, specifier: string): Promise<string> {
    const local = specifier.startsWith('.') ? new URL(specifier, importer) : undefined
    if (specifier.endsWith('.astro') && local) {
      const key = relative(fileURLToPath(SOURCE), fileURLToPath(local))
      if (options.stubs?.[key] !== undefined) return compile(local, options.stubs[key])
      return real.has(key) ? compile(local) : compile(local, '<slot />')
    }
    const exports: Exports = options.modules?.[specifier] ?? await import(/* @vite-ignore */ local ? fileURLToPath(local) : specifier)
    const key = `${load}:${local?.href ?? specifier}`
    modules.set(key, exports)
    const access = `globalThis[Symbol.for('libtmux.astro-templates')].get(${JSON.stringify(key)})`
    const names = Object.keys(exports).filter((name) => name !== 'default')
    return dataModule(`${names.length ? `export const { ${names.join(', ')} } = ${access};` : ''}${
      'default' in exports ? `export default ${access}.default;` : ''}`)
  }

  const file = new URL(entry, SOURCE)
  return (await import(/* @vite-ignore */ await compile(file, options.stubs?.[entry]))).default
}

export interface AstroRender {
  url?: string
  props?: Record<string, unknown>
  slots?: Record<string, string>
}

export async function renderAstroTemplate(template: unknown, { url = 'https://libtmux.org/', props, slots }: AstroRender = {}) {
  const container = await experimental_AstroContainer.create()
  return container.renderToString(template as Parameters<typeof container.renderToString>[0], {
    request: new Request(url), props, slots,
  })
}

/** Drop the per-file scope attribute, which depends on the checkout path. */
export const withoutScope = (html: string) => html.replace(/ data-astro-cid-[a-z0-9]+(?:="")?/g, '')
