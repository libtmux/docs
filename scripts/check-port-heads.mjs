#!/usr/bin/env node
/**
 * Run a port's publish-time docs steps against docs main without deploying.
 *
 * A port's own docs workflow regenerates its API model and guides from the
 * port's head, so a change in the port can break the docs build while docs CI,
 * which reads committed models and guides, stays green. The scheduled
 * port-heads workflow checks out each port's default-branch head and runs this
 * to find those breaks before a release does.
 *
 *   node scripts/check-port-heads.mjs matrix
 *       Print the workflow matrix: one leg per port.
 *   node scripts/check-port-heads.mjs run --port <slug> --checkout <dir>
 *         [--provisioned a,b] [--phases badges,model,usage]
 *       Run the phases for one port, print a line per phase, exit 1 on any
 *       failure. Only LIBTMUX_DOCS_CHECKOUT_<PORT> is set, so a wrapper leg
 *       proves the wrapper alone is enough.
 *
 * Phases:
 *   badges  check-port-badges.mjs on the port's staged guides.
 *   model   stage-port-source.sh, the steps build-site.sh runs for a port
 *           publish: gen-api-model, stage-port-docs, gen-tmux-usage.
 *   usage   gen-tmux-usage.mjs for a wrapper whose model needs a native exporter.
 *
 * `model` needs the port's exporter output or toolchain, which a plain runner
 * lacks. A port in NEEDS_TOOLCHAIN reports `skipped` unless the workflow named
 * it in --provisioned after installing what it needs.
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORTS } from '../site/src/lib/ports.ts'
import { SOURCE_GUIDE_PORTS } from '../site/src/lib/port-documentation.ts'
import { checkoutVariable } from './lib/port-checkout.mjs'

const scripts = dirname(fileURLToPath(import.meta.url))

/** Ports whose model comes from a native exporter or build product, with what that takes. */
export const NEEDS_TOOLCHAIN = {
  ruby: 'ruby docs exporter', lua: 'lua docs exporter', perl: 'perl docs exporter', powershell: 'PowerShell docs exporter',
  julia: 'Julia docs exporter', erlang: 'Erlang docs exporter', elixir: 'Elixir docs exporter', haskell: 'Haskell docs exporter',
  ocaml: 'OCaml docs exporter', clojure: 'Gradle docs exporter', java: 'Gradle and JDK', kotlin: 'Gradle and JDK',
  scala: 'Gradle and JDK', cxx: 'Doxygen XML', swift: 'Swift symbol graph', lisp: 'mise run docs-artifact',
}

/** Wrappers whose tmux-usage scan needs only the wrapper's checkout, so it runs without the exporter. */
const USAGE_ONLY = ['clojure']

/** Python's model reads three repositories; one checkout cannot stand for it. */
const EXCLUDED = { py: 'its model reads libtmux, tmuxp and libtmux-mcp checkouts' }

export function matrix() {
  return { include: PORTS.filter((port) => !(port.slug in EXCLUDED)).map((port) => ({ port: port.slug, repo: port.repo })) }
}

const run = (command, args, env) => spawnSync(command, args, { env, encoding: 'utf8', maxBuffer: 1 << 26 })

export function phasesFor(port, { provisioned = [], requested } = {}) {
  const all = SOURCE_GUIDE_PORTS.includes(port)
    ? [{ name: 'badges', command: process.execPath, args: [join(scripts, 'check-port-badges.mjs'), '--port', port, '--require'] }] : []
  const ready = !(port in NEEDS_TOOLCHAIN) || provisioned.includes(port)
  if (ready) all.push({ name: 'model', command: 'bash', args: [join(scripts, 'stage-port-source.sh')] })
  else if (USAGE_ONLY.includes(port)) all.push({ name: 'usage', command: process.execPath, args: [join(scripts, 'gen-tmux-usage.mjs'), '--ports', port] })
  else all.push({ name: 'model', skipped: `needs ${NEEDS_TOOLCHAIN[port]}; not provisioned in this job` })
  return requested ? all.filter((phase) => requested.includes(phase.name)) : all
}

/** Check one port; returns the report lines and whether every phase passed. */
export function checkPort(port, checkout, options = {}) {
  const head = run('git', ['-C', checkout, 'rev-parse', 'HEAD'], process.env)
  if (head.status !== 0) return { ok: false, lines: [`${port}: FAIL: ${checkout} is not a git checkout`] }
  const sha = head.stdout.trim()
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('LIBTMUX_DOCS_CHECKOUT_')))
  Object.assign(env, { LIBTMUX_DOCS_PORT: port, LIBTMUX_DOCS_SOURCE_SHA: sha, LIBTMUX_DOCS_SOURCE_REF: sha, [checkoutVariable(port)]: checkout })
  const lines = []
  let ok = true
  for (const phase of phasesFor(port, options)) {
    if (phase.skipped) {
      lines.push(`${port}: ${phase.name}: skipped: ${phase.skipped}`)
      continue
    }
    const result = run(phase.command, phase.args, env)
    if (result.status === 0) {
      lines.push(`${port}: ${phase.name}: ok`)
      continue
    }
    ok = false
    const detail = `${result.stderr}${result.stdout}`.trim().split('\n').slice(-12).join('\n')
    lines.push(`${port}: ${phase.name}: FAIL\n${detail.replace(/^/gm, '    ')}`)
  }
  return { ok, lines }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
  const [command] = process.argv.slice(2)
  if (command === 'matrix') {
    const json = JSON.stringify(matrix())
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${json}\n`)
    console.log(json)
  } else if (command === 'run') {
    const port = option('--port')
    const checkout = option('--checkout')
    if (!PORTS.some((entry) => entry.slug === port) || !checkout) throw new Error('usage: check-port-heads.mjs run --port <slug> --checkout <dir>')
    const { ok, lines } = checkPort(port, resolve(checkout), {
      provisioned: option('--provisioned')?.split(',') ?? [], requested: option('--phases')?.split(','),
    })
    console.log(lines.join('\n'))
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.map((line) => `- ${line.split('\n')[0]}`).join('\n')}\n`)
    process.exit(ok ? 0 : 1)
  } else {
    throw new Error('usage: check-port-heads.mjs matrix | run --port <slug> --checkout <dir>')
  }
}
