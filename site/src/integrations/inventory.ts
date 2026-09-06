import { DEFAULT_LOCALE } from '../i18n/locales'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AstroIntegration } from 'astro'
import { writeInventory, type ApiModel } from '@libtmux/api-model'
import { API_MODELS, PORT_NAME, ownersOf, pageSlug } from '../lib/api-models'

/**
 * Publish an `objects.inv` per port, and one for the whole reference.
 *
 * This is what makes libtmux.org linkable from any Sphinx project — including
 * our own, since the Python docs are Sphinx. Adding libtmux.org to their
 * `intersphinx_mapping` lets a docstring write ``:class:`libtmux-rs:Pane` ``
 * and get a working link, which is cross-language linking through the
 * mechanism Sphinx already ships.
 *
 * Written at `astro:build:done` rather than as a route: the file is bytes, not
 * a page, and a route would have to base64 its way through a text response.
 *
 * Emitted only from the root build, and only in the default locale. The
 * reference lives at `/reference/` and has no per-port mount, so a per-port
 * build writing one would publish an inventory of URLs that do not exist
 * under its own prefix — and the reference is not translated, so a Japanese
 * build wrote an inventory of `/ja/reference/…` for the same reason. An
 * inventory is consumed by other projects' Sphinx builds rather than by a
 * reader, so a wrong one breaks their links, not ours, and nothing here
 * would have reported it.
 */
export function inventory(): AstroIntegration {
  return {
    name: 'libtmux:inventory',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        if (process.env.LIBTMUX_DOCS_PORT) return
        // The env var, not `buildLocale()` from i18n/resolve: this runs as an
        // Astro integration, in the config context, where `astro:content` —
        // which that module imports — does not exist.
        if ((process.env.LIBTMUX_DOCS_LOCALE || DEFAULT_LOCALE) !== DEFAULT_LOCALE) return
        const out = dir.pathname
        let total = 0

        /**
         * A URI as intersphinx reads it: relative to the directory holding
         * the inventory, never to the site root.
         *
         * `rooted` is what tells the two apart. The combined inventory sits
         * at `/objects.inv` and needs the `reference/<port>/` prefix; a
         * per-port one sits at `/reference/<port>/objects.inv` and must not
         * carry it, because intersphinx joins the URI onto the base URL it
         * was configured with. With the prefix in both, a resolved C++ class
         * came out as
         * `libtmux.org/reference/cxx/reference/cxx/libtmux::pane/` — a link
         * that Sphinx reported as resolved and that goes nowhere.
         */
        const uriFor = (model: ApiModel, rooted = true) => {
          const paged = new Set(ownersOf(model).map((s) => s.id))
          return (symbol: { id: string; publicId?: string; parent?: string }) => {
            const anchor = symbol.publicId ?? symbol.id
            const owner = paged.has(symbol.id)
              ? anchor
              : symbol.parent && paged.has(symbol.parent)
                ? (model.symbols.find((s) => s.id === symbol.parent)?.publicId ?? symbol.parent)
                : undefined
            const page = owner ? `${pageSlug(owner)}/` : ''
            const prefix = rooted ? `reference/${model.port}/` : ''
            return `${prefix}${page}#${anchor}`
          }
        }

        for (const [port, model] of Object.entries(API_MODELS)) {
          const bytes = writeInventory(model, {
            project: `libtmux for ${PORT_NAME[port] ?? port}`,
            version: model.revision?.slice(0, 7) ?? 'latest',
            uriFor: uriFor(model, false),
          })
          const path = join(out, 'reference', port, 'objects.inv')
          mkdirSync(dirname(path), { recursive: true })
          writeFileSync(path, bytes)
          total += model.symbols.length
        }

        // One combined inventory at the site root, so a consumer needs a
        // single mapping entry rather than eight.
        const combined: ApiModel = {
          port: 'py',
          extractor: 'libtmux.org',
          symbols: Object.values(API_MODELS).flatMap((m) =>
            m.symbols.map((s) => ({
              ...s,
              // Prefixed, because ids are unique *within* a port and this file
              // spans all eight. `libtmux.Pane` exists in more than one.
              publicId: `${m.port}:${s.publicId ?? s.id}`,
            })),
          ),
        }
        const byPort = new Map(Object.entries(API_MODELS).map(([p, m]) => [p, uriFor(m)]))
        writeFileSync(
          join(out, 'objects.inv'),
          writeInventory(combined, {
            project: 'libtmux',
            version: 'all',
            uriFor: (s) => {
              const [port] = (s.publicId ?? s.id).split(':')
              const inner = { ...s, publicId: (s.publicId ?? s.id).slice(port.length + 1) }
              return byPort.get(port)?.(inner) ?? 'reference/'
            },
          }),
        )

        logger.info(`objects.inv written for ${Object.keys(API_MODELS).length} ports (${total} symbols) + combined`)
      },
    },
  }
}
