import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AstroIntegration } from 'astro'
import { API_MODELS } from '../lib/api-models'
import { collectInventoryTargets, publishPortInventory } from '../lib/inventory-publisher'
import { buildTarget } from '../lib/versions'
import { withPortRoot } from '../lib/site-root'

/** Port exports follow rendering; the full export follows final site assembly. */
export function inventory(): AstroIntegration {
  let base = '/'
  return {
    name: 'libtmux:inventory',
    hooks: {
      'astro:config:done': ({ config }) => { base = `${config.base.replace(/\/$/, '')}/` },
      'astro:build:done': ({ dir, logger }) => {
        const port = process.env.LIBTMUX_DOCS_PORT
        const version = buildTarget(process.env).version
        if (port && base !== withPortRoot(`/${port}/${version}/`)) return
        const out = fileURLToPath(dir)
        const targets = collectInventoryTargets(out, base)
        if (port) {
          const actual = new Set(targets.filter((target) => target.scope === port && target.category === 'api').map((target) => target.identity))
          const missing = API_MODELS[port]?.symbols.filter((symbol) => !actual.has(symbol.publicId ?? symbol.id)) ?? []
          if (missing.length) throw new Error(`Inventory missed ${missing.length} API declarations for ${port}: ${missing.slice(0, 10).map((symbol) => symbol.publicId ?? symbol.id).join(', ')}`)
          const result = publishPortInventory(out, base, targets, port, version)
          logger.info(`objects.inv: ${result.targets} rendered targets for ${port}/${result.version}`)
          return
        }
        // A shell alone has no core port trees. It cannot publish the full export.
        writeFileSync(join(out, 'targets.partial.json'), `${JSON.stringify({ schema: 1, base, targets })}\n`)
        logger.info(`${targets.length} rendered inventory targets collected; full export awaits assembly`)
      },
    },
  }
}
