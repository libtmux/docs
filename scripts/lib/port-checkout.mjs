/**
 * Where a port's source checkout is, in one place.
 *
 * Every generator used to read `LIBTMUX_DOCS_CHECKOUT_<PORT>` itself, and each
 * knew a different slice of the rules. A wrapper port (`parentLibrary` in
 * ports.ts) lives in its core library's repository, so a build that checks out
 * only the wrapper must also serve the core library from that checkout; a
 * script that forgot this threw only on a clean CI runner.
 *
 * Order, first match wins:
 *  1. `LIBTMUX_DOCS_CHECKOUT_<PORT>`.
 *  2. For a core port, the override of a wrapper that shares its repository.
 *  3. The port's ports.ts `worktree` and `checkout`, in the order the caller asks for.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PORTS } from '../../site/src/lib/ports.ts'

export const checkoutVariable = (slug) => `LIBTMUX_DOCS_CHECKOUT_${slug.toUpperCase()}`

export const expandHome = (path) => (path.startsWith('~/') ? join(homedir(), path.slice(2)) : path)

const lookup = (port, ports) => {
  if (typeof port !== 'string') return port
  const found = ports.find((entry) => entry.slug === port)
  if (!found) throw new Error(`port-checkout: unknown port ${port}`)
  return found
}

/**
 * The explicit location a build gave this port, if any: its own variable, else
 * the variable of a wrapper that shares its repository. A wrapper's own
 * checkout is the core library's checkout, because they are one repository.
 */
export function checkoutOverride(port, { ports = PORTS, env = process.env } = {}) {
  // A slug outside ports.ts (a fence language, say) can still be overridden by name.
  const { slug, repo } = typeof port === 'string' ? (ports.find((entry) => entry.slug === port) ?? { slug: port }) : port
  const own = env[checkoutVariable(slug)]
  if (own) return expandHome(own)
  for (const wrapper of ports) {
    if (wrapper.parentLibrary?.slug !== slug || wrapper.repo !== repo) continue
    const shared = env[checkoutVariable(wrapper.slug)]
    if (shared) return expandHome(shared)
  }
  return undefined
}

/**
 * Locations to try, best first. `order` names the ports.ts fields to fall back
 * on: `worktree` is the docs-branch worktree, `checkout` the working clone.
 */
export function checkoutCandidates(port, { ports = PORTS, env = process.env, order = ['worktree', 'checkout'] } = {}) {
  const entry = lookup(port, ports)
  const explicit = checkoutOverride(entry, { ports, env })
  const fallbacks = order.map((field) => entry[field]).filter(Boolean).map(expandHome)
  return [...new Set([...(explicit ? [explicit] : []), ...fallbacks])]
}

/** The one location a script reads: the override, else the first fallback. */
export function resolveCheckout(port, options = {}) {
  const [first] = checkoutCandidates(port, options)
  if (!first) throw new Error(`port-checkout: ${typeof port === 'string' ? port : port.slug} has no checkout`)
  return first
}

/**
 * The ports a run names as allowed to lack a checkout: `--allow-missing go,py`.
 * Without the flag no port may.
 */
export function allowMissingPorts(argv = process.argv) {
  const at = argv.indexOf('--allow-missing')
  if (at < 0) return []
  const value = argv[at + 1]
  if (!value || value.startsWith('--')) throw new Error('--allow-missing takes a comma-separated list of port slugs')
  return value.split(',').map((slug) => slug.trim()).filter(Boolean)
}

/**
 * What it means that a check cannot read a port's source. A check that reads
 * nothing proves nothing, and a run that passes anyway reads as proof, so the
 * port fails unless the run named it in `allowMissing`, which records a skip.
 *
 * @param {string} slug
 * @param {string | undefined} unreadable Why the source cannot be read, or undefined when it can.
 * @param {readonly string[]} allowMissing
 * @returns {{ outcome: 'checked' | 'skipped' | 'failed', message?: string }}
 */
export function sourceGate(slug, unreadable, allowMissing = []) {
  if (!unreadable) return { outcome: 'checked' }
  if (allowMissing.includes(slug)) return { outcome: 'skipped', message: `${slug} (${unreadable})` }
  return { outcome: 'failed', message: `${slug}: not checked, ${unreadable}. Provide the checkout, or name the port with --allow-missing.` }
}
