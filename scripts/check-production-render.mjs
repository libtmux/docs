#!/usr/bin/env node
/*
 * The production root renders were made before the assembly they are audited
 * beside existed.
 *
 * A full audit renders them after the assembly, from its versions.json, in the
 * tree that assembled it. The publication jobs render them while the assembly
 * is still building, so each render is the one the assembly would have
 * produced only if it started from the same defaults and read the same
 * inputs. Both are checked here instead of assumed:
 *
 *   LIBTMUX_DOCS_PRODUCTION_DEFAULTS  the defaults the renders were given
 *   LIBTMUX_DOCS_PRODUCTION_INPUTS    scripts/fingerprint.mjs after rendering
 *   LIBTMUX_DOCS_BUILD_INPUTS         scripts/fingerprint.mjs after assembling
 *
 * Usage: node scripts/check-production-render.mjs <assembled versions.json>
 */
import { readFileSync } from 'node:fs'

const sorted = (value) => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1))))

function problems(env, versionsPath) {
  const found = []
  let rendered
  try {
    rendered = sorted(JSON.parse(env.LIBTMUX_DOCS_PRODUCTION_DEFAULTS))
  } catch {
    found.push('LIBTMUX_DOCS_PRODUCTION_DEFAULTS is not the JSON object scripts/port-defaults.sh prints')
  }
  if (rendered) {
    const assembled = sorted(JSON.parse(readFileSync(versionsPath, 'utf8')).defaultVersion)
    if (rendered !== assembled) {
      found.push(
        'the production roots were rendered with other default versions than the assembly kept\n' +
          `  rendered:  ${rendered}\n  assembled: ${assembled}`,
      )
    }
  }
  const production = env.LIBTMUX_DOCS_PRODUCTION_INPUTS
  const build = env.LIBTMUX_DOCS_BUILD_INPUTS
  if (!production || !build) {
    found.push('LIBTMUX_DOCS_PRODUCTION_INPUTS and LIBTMUX_DOCS_BUILD_INPUTS must both name a scripts/fingerprint.mjs digest')
  } else if (production !== build) {
    found.push(
      'the production roots and the assembly read different build inputs\n' +
        `  roots:    ${production}\n  assembly: ${build}`,
    )
  }
  return found
}

const versionsPath = process.argv[2]
if (!versionsPath) {
  console.error('usage: check-production-render.mjs <assembled versions.json>')
  process.exit(2)
}
const found = problems(process.env, versionsPath)
if (found.length > 0) {
  for (const message of found) console.error(`check-production-render: ${message}`)
  process.exit(1)
}
console.log("check-production-render: the roots started from the assembly's defaults and inputs")
