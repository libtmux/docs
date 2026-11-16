/**
 * Behaviour facts, attached to the model they were read from.
 *
 * `scripts/gen-api-behavior.mjs` reads each port's doc comments at the model's pinned revision and writes a sidecar
 * per port. The sidecar is joined to the model here, as `ApiSymbol.behavior`, only when its revision is the model's:
 * a fact cites a line, and a line means nothing at another revision. A sidecar of another revision is refused with an
 * error: a port's build regenerates its model at the port's head and must regenerate the sidecar with it.
 */
import type { ApiModelBase, Behavior } from '@libtmux/api-model/reference'

export interface BehaviorSidecar {
  port: string
  repo?: string
  revision?: string
  symbols: Record<string, { behavior: Behavior; evidence?: Record<string, string> }>
}

/** Join a sidecar to its model. Returns how many declarations received facts; a sidecar of another revision is refused. */
export function attachBehavior(model: ApiModelBase, sidecar: BehaviorSidecar): number {
  if (!model.revision || sidecar.revision !== model.revision) {
    throw new Error(`behaviour sidecar for ${sidecar.port} is for ${String(sidecar.revision).slice(0, 12)}, the model for ${String(model.revision).slice(0, 12)}; run node scripts/gen-api-behavior.mjs ${sidecar.port} (a source-bound build runs it with --source-bound)`)
  }
  let attached = 0
  for (const symbol of model.symbols) {
    const entry = sidecar.symbols[symbol.publicId ?? symbol.id]
    if (!entry) continue
    symbol.behavior = entry.behavior
    attached++
  }
  return attached
}
