import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as pagefind from 'pagefind'
import { vi } from 'vitest'
import type { PagefindApi } from '../src/lib/search-panel'

/** A page as the build would hand it to Pagefind. */
export interface FixturePage {
  url: string
  html: string
}

/** What Pagefind stored for one page: the text it indexed, its filters and its metadata. */
export interface IndexedPage {
  url: string
  content: string
  filters: Record<string, string[]>
  meta: Record<string, string>
}

export interface FixtureIndex {
  /** Pagefind's own browser client, run in Node against the index built from the fixture pages. */
  api: PagefindApi
  /** Every page of the index, in no particular order. */
  pages: () => Promise<IndexedPage[]>
  close: () => Promise<void>
}

/**
 * A real Pagefind index of `pages`, searched with Pagefind's own client.
 *
 * The engine and the client are the ones the site ships, so a filter that
 * Pagefind drops, a result order or an excerpt is what a reader would get from
 * the same pages. The index is written to a temporary directory and the client
 * reads it through `fetch`, which a test replaces for `file:` addresses only.
 */
export async function buildIndex(pages: readonly FixturePage[]): Promise<FixtureIndex> {
  const { index } = await pagefind.createIndex()
  const dir = await mkdtemp(join(tmpdir(), 'libtmux-pagefind-'))
  const close = async () => {
    vi.unstubAllGlobals()
    await pagefind.close()
    await rm(dir, { recursive: true, force: true })
  }
  try {
    for (const page of pages) {
      const { errors } = await index!.addHTMLFile({ url: page.url, content: page.html })
      if (errors.length) throw new Error(`${page.url}: ${errors.join('; ')}`)
    }
    const written = await index!.writeFiles({ outputPath: join(dir, 'pagefind') })
    if (written.errors.length) throw new Error(written.errors.join('; '))
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      return url.protocol === 'file:' ? new Response(await readFile(fileURLToPath(url))) : realFetch(input, init)
    })
    const api = (await import(/* @vite-ignore */ pathToFileURL(join(dir, 'pagefind', 'pagefind.js')).href)) as PagefindApi
    await api.options?.({ excerptLength: 22, baseUrl: '/' })
    await api.init?.()
    return {
      api,
      close,
      pages: async () => {
        const all = await api.search(null)
        return Promise.all(all.results.map(async (result) => {
          const data = (await result.data()) as unknown as IndexedPage
          return { url: data.url, content: data.content, filters: data.filters, meta: data.meta as Record<string, string> }
        }))
      },
    }
  } catch (error) {
    await close()
    throw error
  }
}
