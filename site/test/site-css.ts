import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compile } from 'tailwindcss'

/**
 * The site's own stylesheet as Astro builds it: `global.css` with Tailwind's preflight and utilities, the typography
 * plugin and the theme plugin, compiled for the classes a test page uses. A browser test that wants the cascade a
 * reader gets, such as an element Tailwind's preflight resets, reads it from here instead of restating the rules.
 */
const require = createRequire(import.meta.url)
const STYLES = fileURLToPath(new URL('../src/styles/', import.meta.url))

const stylesheet = (path: string) => ({ path, base: dirname(path), content: readFileSync(path, 'utf8') })

/**
 * `global.css` compiled for `candidates`, the class names that the page under test uses. `edit` changes the stylesheet's
 * text first, which is how a test removes a rule to show that its check can fail.
 */
export async function siteCss(candidates: string[], edit: (source: string) => string = (source) => source): Promise<string> {
  const compiler = await compile(edit(readFileSync(`${STYLES}global.css`, 'utf8')), {
    base: STYLES,
    loadStylesheet: async (id, base) => stylesheet(id.startsWith('.') ? resolve(base, id) : require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id)),
    loadModule: async (id, base) => {
      const path = id === '@libtmux/theme' ? fileURLToPath(new URL('../../packages/theme/src/index.ts', import.meta.url)) : require.resolve(id, { paths: [base] })
      const module = await import(pathToFileURL(path).href)
      return { path, base: dirname(path), module: module.default ?? module }
    },
  })
  return compiler.build(candidates)
}
