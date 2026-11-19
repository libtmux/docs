import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import type { Window } from 'happy-dom'

/**
 * Run a widget's script in a window, as the page would after its markup.
 *
 * `file` is a `.astro` component (its `<script>`), a `.ts` module or a `.js`
 * file. Each is compiled to CommonJS and its relative imports are loaded the
 * same way, so a widget that imports a helper is exercised with that helper.
 */
export function runWidgetScript(window: Window, file: URL): void {
  const modules = new Map<string, Record<string, unknown>>()
  const resolve = (from: string, specifier: string) => {
    const base = join(dirname(from), specifier)
    return [base, `${base}.ts`, `${base}.js`].find((path) => existsSync(path) && !path.endsWith('/'))
  }
  const run = (path: string, source: string): Record<string, unknown> => {
    const module = { exports: {} as Record<string, unknown> }
    modules.set(path, module.exports)
    const out = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, allowJs: true } }).outputText
    const load = window.eval(`(function (require, module, exports) {\n${out}\n})`) as (...args: unknown[]) => void
    load((specifier: string) => {
      const target = specifier.startsWith('.') ? resolve(path, specifier) : undefined
      if (!target) throw new Error(`widget script: cannot load "${specifier}" from ${path}`)
      return modules.get(target) ?? run(target, readFileSync(target, 'utf8'))
    }, module, module.exports)
    return module.exports
  }
  const path = fileURLToPath(file)
  const source = readFileSync(path, 'utf8')
  run(path, path.endsWith('.astro') ? source.match(/<script>([\s\S]*?)<\/script>/)![1]! : source)
}
