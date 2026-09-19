import { readdir, readFile } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { glob } from 'astro/loaders'
import type { Loader, LoaderContext } from 'astro/loaders'
import { parseFrontmatter } from '@astrojs/markdown-remark'
import { PORTS } from '../lib/ports.ts'
import { KNOWN_PORTS, resolvePortBody, resolvePortData } from '../lib/workspace-shared-slots.ts'

/**
 * One shared workspace page, rendered per port.
 *
 * `notes/decisions/per-language-prose.md` filters fenced *code* by language
 * at render time, from one physical file shared by every port build. A
 * workspace product page's per-port difference is prose, not code — a
 * paragraph, a heading, a source link — so this applies the same "one
 * source, filtered per port" idea to text, and synthesizes the eight
 * `ports/<port>/...` collection entries `docsPath`/`docsRoutePath` already
 * expect, instead of changing either of those.
 *
 * A shared source lives under `src/content/_workspace-shared/<relpath>`, one
 * file per relative path (matching the 8 duplicate files it replaces). Its
 * frontmatter carries shared defaults plus a `ports.<slug>` map of
 * overrides; its body carries shared prose plus `<!-- port:LIST --> ...
 * <!-- /port -->` regions, nestable, that survive only for a port in LIST.
 * The slot/merge logic itself lives in `../lib/workspace-shared-slots.ts`
 * (dependency-free — `scripts/gen-mentions.mjs` and
 * `scripts/check-api-links.mjs` import it too, since both scan the
 * filesystem directly and cannot see synthetic loader entries).
 * See `site/test/workspace-shared.test.ts` and
 * `notes/decisions/workspace-shared-pages.md`, which also records which
 * relative paths stayed as 8 separate files and why.
 */

const DOCS_BASE = './src/content/docs'
const DOCS_PATTERN = '**/*.{md,mdx}'
const SHARED_BASE = './src/content/_workspace-shared'
const PRODUCT = 'workspace'
const PORT_SLUGS = PORTS.map((port) => port.slug).filter((slug) => KNOWN_PORTS.has(slug))

/* ---------------------------------------------------------------------- */
/* Loader                                                                  */
/* ---------------------------------------------------------------------- */

async function walkMarkdown(dir: string): Promise<string[]> {
  const out: string[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return out
    throw err
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walkMarkdown(full)))
    else if (entry.isFile() && (extname(entry.name) === '.md' || extname(entry.name) === '.mdx')) out.push(full)
  }
  return out
}

/** `workspace/index.md` -> `workspace`, matching Astro's own default id/slug folding. */
function idFor(relPath: string): string {
  return relPath.replace(/\.mdx?$/, '').replace(/\/index$/, '')
}

/**
 * JSON is valid YAML, so this round-trips through the same `parseFrontmatter`
 * a real file's frontmatter fence would, and `renderMarkdown` hands the
 * result to every remark/rehype plugin as `file.data.astro.frontmatter` —
 * notably `rehype-api-links.ts`, which links symbols by `frontmatter.port`.
 *
 * SPIKE: avoids depending on Astro's untyped `context.entryTypes` runtime
 * field (present at runtime, absent from the public `LoaderContext` type;
 * see `astro/dist/content/loaders/glob.js`). Revisit with a real YAML
 * serializer if a future field needs a form JSON cannot express.
 */
function frontmatterBlock(data: Record<string, unknown>): string {
  return `---\n${JSON.stringify(data)}\n---\n`
}

/**
 * Loads the `docs` collection: every hand-authored page under
 * `src/content/docs`, delegated to Astro's own `glob()` loader unchanged,
 * plus one synthetic entry per port for each shared workspace page under
 * `src/content/_workspace-shared`.
 */
export function workspaceDocsLoader(): Loader {
  return {
    name: 'workspace-docs',
    load: async (context: LoaderContext) => {
      // Delegate first: glob() clears any store id it did not touch, so the
      // synthetic entries below must be written after it returns, not before.
      await glob({ base: DOCS_BASE, pattern: DOCS_PATTERN }).load(context)
      // A port whose own hand-authored page already owns an id keeps that
      // page; the shared source only fills ids no real page claims.
      const realIds = new Set(context.store.keys())

      const sharedDir = fileURLToPath(new URL(SHARED_BASE, context.config.root))
      const root = fileURLToPath(context.config.root)
      const ownedIds = new Map<string, string[]>()
      let revision = 0

      const removeFile = (file: string) => {
        for (const id of ownedIds.get(file) ?? []) context.store.delete(id)
        ownedIds.delete(file)
      }
      const reportError = (file: string, error: unknown) => {
        context.logger.error(`Failed to reload ${relative(root, file)}: ${error instanceof Error ? error.message : String(error)}`)
      }

      const syncShared = async (version: number, initial = false) => {
        if (version !== revision) return
        const files = new Set(await walkMarkdown(sharedDir))
        if (version !== revision) return
        for (const file of ownedIds.keys()) {
          if (!files.has(file)) removeFile(file)
        }
        for (const file of files) {
          const relPath = relative(sharedDir, file).split(sep).join('/')
          const relFilePath = relative(root, file).split(sep).join('/')
          try {
            const raw = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
              if (error.code !== 'ENOENT') throw error
              if (version === revision) removeFile(file)
              return undefined
            })
            if (raw === undefined) continue
            const ports = PORT_SLUGS.filter((port) => !realIds.has(`ports/${port}/${idFor(relPath)}`))
            const ids = ports.map((port) => `ports/${port}/${idFor(relPath)}`)
            const digests = ports.map((port) => context.generateDigest(`${port}\u0000${raw}`))
            if (ownedIds.has(file) && ids.every((id, index) => context.store.get(id)?.digest === digests[index])) continue
            const { frontmatter, content: body } = parseFrontmatter(raw)
            const entries: Parameters<LoaderContext['store']['set']>[0][] = []

            for (const [index, port] of ports.entries()) {
              const id = ids[index]!
              const data = await context.parseData({ id, data: resolvePortData(frontmatter, port, PRODUCT), filePath: relFilePath })
              const resolvedBody = resolvePortBody(body, port)
              const rendered = await context.renderMarkdown(frontmatterBlock(data) + resolvedBody, {
                fileURL: pathToFileURL(file),
              })
              if (version !== revision) return
              entries.push({ id, data, body: resolvedBody, filePath: relFilePath, digest: digests[index]!, rendered })
            }
            // Publish every port together, only while this source is current.
            for (const entry of entries) context.store.set(entry)
            ownedIds.set(file, ids)
          } catch (error) {
            if (version !== revision) return
            if (initial) throw error
            else reportError(file, error)
          }
        }
      }

      await syncShared(revision, true)

      if (context.watcher) {
        context.watcher.add(sharedDir)
        let pending = Promise.resolve()
        const onChange = (changedPath: string) => {
          const relPath = relative(sharedDir, changedPath)
          if (isAbsolute(relPath) || relPath === '..' || relPath.startsWith(`..${sep}`)
            || !/\.mdx?$/.test(relPath)) return pending
          context.logger.info(`Reloading shared workspace sources (${relative(root, changedPath)} changed)`)
          const version = ++revision
          // Watchers ignore promises, so the queue must contain every failure.
          pending = pending.then(() => syncShared(version)).catch((error: unknown) => reportError(changedPath, error))
          return pending
        }
        context.watcher.on('change', onChange)
        context.watcher.on('add', onChange)
        context.watcher.on('unlink', onChange)
      }
    },
  }
}
