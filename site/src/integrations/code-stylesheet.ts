import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AstroIntegration } from 'astro'

/** Expressive Code's shared stylesheet, which it names `ec.<hash>.css`. */
const CODE_STYLESHEET = /<link rel="stylesheet" href="[^"]*\/ec\.[A-Za-z0-9_-]+\.css"\s*\/?>/g

/**
 * Move Expressive Code's stylesheet link from the first code frame into the head.
 *
 * The router preloads the stylesheets in the incoming page's head and swaps once they have loaded. A link left
 * in the body arrives with the new content and loads afterwards, so a code frame paints unstyled and then moves.
 * A page without code frames is returned as it came.
 */
export function hoistCodeStylesheet(html: string): string {
  const body = html.indexOf('<body')
  const end = html.indexOf('</head>')
  if (body < 0 || end < 0 || end > body) return html
  const links = [...html.slice(body).matchAll(CODE_STYLESHEET)].map(([link]) => link)
  if (links.length === 0) return html
  const [link] = links
  const moved = html.slice(body).replace(CODE_STYLESHEET, '')
  return `${html.slice(0, end)}${link}${html.slice(end, body)}${moved}`
}

/** Hoist the stylesheet on every built page, so that a swap into a code frame lands styled. */
export function codeStylesheet(): AstroIntegration {
  return {
    name: 'libtmux:code-stylesheet',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const out = fileURLToPath(dir)
        let hoisted = 0
        for (const page of (readdirSync(out, { recursive: true }) as string[]).filter((file) => file.endsWith('.html'))) {
          const path = join(out, page)
          const html = readFileSync(path, 'utf8')
          const next = hoistCodeStylesheet(html)
          if (next === html) continue
          writeFileSync(path, next)
          hoisted++
        }
        logger.info(`${hoisted} pages load the code stylesheet from the head`)
      },
    },
  }
}
