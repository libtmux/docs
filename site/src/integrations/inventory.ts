import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AstroIntegration } from 'astro'
import { writeInventory } from '@libtmux/api-model'
import { API_MODELS, PORT_NAME } from '../lib/api-models'
import { productApiHref } from '../lib/product-api'
import { collectInventoryTargets, publishPortInventory } from '../lib/inventory-publisher'
import { buildTarget, defaultVersionFor } from '../lib/versions'
import { DEFAULT_LOCALE } from '../i18n/locales'

/** Port exports follow rendering; the full export follows final site assembly. */
export function inventory(): AstroIntegration {
  let base = '/'
  return {
    name: 'libtmux:inventory',
    hooks: {
      'astro:config:done': ({ config }) => { base = `${config.base.replace(/\/$/, '')}/` },
      'astro:build:done': ({ dir, logger }) => {
        const out = fileURLToPath(dir)
        const targets = collectInventoryTargets(out, base)
        const port = process.env.LIBTMUX_DOCS_PORT
        if (port) {
          const actual = new Set(targets.filter((target) => target.scope === port && target.category === 'api').map((target) => target.identity))
          const missing = API_MODELS[port]?.symbols.filter((symbol) => !actual.has(symbol.publicId ?? symbol.id)) ?? []
          if (missing.length) throw new Error(`Inventory missed ${missing.length} API declarations for ${port}: ${missing.slice(0, 10).map((symbol) => symbol.publicId ?? symbol.id).join(', ')}`)
          const result = publishPortInventory(out, base, targets, port, buildTarget(process.env).version)
          logger.info(`objects.inv: ${result.targets} rendered targets for ${port}/${result.version}`)
          return
        }
        // A shell alone has no core port trees. It cannot publish the full export.
        writeFileSync(join(out, 'targets.partial.json'), `${JSON.stringify({ schema: 1, base, targets })}\n`)
        if ((process.env.LIBTMUX_DOCS_LOCALE || DEFAULT_LOCALE) !== DEFAULT_LOCALE) return
        for (const [port, model] of Object.entries(API_MODELS)) {
          const inventoryBase = `${base}reference/${port}/`
          const path = join(out, 'reference', port, 'objects.inv')
          mkdirSync(dirname(path), { recursive: true })
          writeFileSync(path, writeInventory(model, {
            project: `libtmux for ${PORT_NAME[port] ?? port}`, version: model.revision?.slice(0, 7) ?? 'latest',
            uriFor: (symbol) => `${posix.relative(inventoryBase, productApiHref(model, symbol, defaultVersionFor(port)))}/#${encodeURIComponent(symbol.publicId ?? symbol.id)}`,
          }))
        }
        logger.info(`${targets.length} rendered inventory targets collected; full export awaits assembly`)
      },
    },
  }
}
