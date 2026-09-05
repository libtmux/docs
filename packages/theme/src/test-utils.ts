/**
 * Test helpers for the Tailwind plugin.
 *
 * Ported from ~/work/typescript/tony.sh's `packages/tailwind-plugin` along
 * with the plugin itself and its four test files — but the file was left
 * behind, so three of those four suites have been failing to even import
 * since the port. Only `compileWithPlugin` is brought across; the upstream
 * file also exports `expectNoHistoricalBugs`, `extractThemeVariables` and
 * `countPatterns`, and nothing here calls them. Porting them too would add
 * dead code that looks maintained.
 */
import { compile } from 'tailwindcss'
import tailwindPlugin from './tailwind-plugin'

/**
 * Compile CSS through the theme plugin and return the result.
 *
 * Uses Tailwind v4's `compile` API with a stub module loader, so the plugin
 * is exercised exactly as Tailwind would load it — no build step, no config
 * file on disk.
 *
 * @param content - Class names to compile, as they would appear in markup.
 * @returns The generated CSS.
 */
export async function compileWithPlugin(content: string[]): Promise<string> {
  const css = `
    @tailwind base;
    @tailwind utilities;
    @plugin "theme-plugin";
  `

  const compiler = await compile(css, {
    // `async` is load-bearing: Tailwind's LoadModule type returns a Promise,
    // and dropping it for "there is no await here" is a type error, not a
    // tidy-up.
    loadModule: async (id: string) => {
      if (id === 'theme-plugin') {
        return {
          base: '/root',
          module: tailwindPlugin,
          path: '/root/theme-plugin.js',
        }
      }
      throw new Error(`Unknown module: ${id}`)
    },
  })

  return compiler.build(content)
}
