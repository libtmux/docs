import { closeSync, openSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AstroIntegration } from 'astro'
import { headVerdict } from '../lib/sitemap-heads'

const HEAD_BYTES = 262_144

/** The first bytes of a file: a document's head ends well inside them. */
export function readHead(file: string): string {
  const fd = openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(HEAD_BYTES)
    return buffer.subarray(0, readSync(fd, buffer, 0, HEAD_BYTES, 0)).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/**
 * Find the pages whose own head keeps them out of a sitemap.
 *
 * Register it before `@astrojs/sitemap`. That integration filters by URL
 * alone, and this one runs first in the same `astro:build:done` and records
 * which of the build's pages say `noindex`, redirect elsewhere or name another
 * canonical, so the sitemap's filter can ask `listed(url)`.
 */
export function pageHeads(site: string, base: string) {
  const unlisted = new Set<string>()
  const root = new URL(base, site)
  const integration: AstroIntegration = {
    name: 'libtmux:sitemap-heads',
    hooks: {
      'astro:build:done': ({ dir, pages, logger }) => {
        const out = fileURLToPath(dir)
        for (const { pathname } of pages) {
          const path = pathname.replace(/^\/+/, '')
          const url = new URL(path, root).href
          let html: string
          try { html = readHead(join(out, path, 'index.html')) } catch { continue }
          if (!headVerdict(html, url).listed) unlisted.add(url)
        }
        logger.info(`${unlisted.size} pages stay out of the sitemap by their own head`)
      },
    },
  }
  return { integration, listed: (url: string) => !unlisted.has(url) }
}
