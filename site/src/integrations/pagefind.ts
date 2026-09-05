import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { AstroIntegration } from 'astro'

/**
 * Run the Pagefind CLI over the built output.
 *
 * Pagefind indexes rendered HTML, which is why it can cover this site: the
 * Astro shell, the Sphinx-rendered ports and the skinned native generators
 * all end up as HTML in the same output tree, and Pagefind does not care
 * which tool produced which page.
 *
 * Roughly forty lines. This is the entire cost of not adopting a docs
 * framework for the sake of its bundled search.
 */
export function pagefind(): AstroIntegration {
  return {
    name: 'libtmux:pagefind',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        if (process.env.LIBTMUX_DOCS_SKIP_PAGEFIND === 'true') {
          logger.info('skipped (LIBTMUX_DOCS_SKIP_PAGEFIND)')
          return
        }
        const target = fileURLToPath(dir)
        logger.info(`indexing ${target}`)
        return new Promise<void>((resolve, reject) => {
          const proc = spawn('pnpm', ['exec', 'pagefind', '--site', target], { stdio: 'inherit' })
          proc.on('close', (code) =>
            code === 0 ? resolve() : reject(new Error(`pagefind exited ${code}`)),
          )
          proc.on('error', reject)
        })
      },
    },
  }
}
