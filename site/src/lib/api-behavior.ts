/**
 * Behaviour facts, attached to the model they were read from.
 *
 * `scripts/gen-api-behavior.mjs` reads each port's doc comments at the model's pinned revision and writes a sidecar
 * per port. The sidecar is joined to the model here, as `ApiSymbol.behavior`, only when its revision is the model's:
 * a fact cites a line, and a line means nothing at another revision.
 */
import type { ApiModelBase, Behavior } from '@libtmux/api-model/reference'

export interface BehaviorSidecar {
  port: string
  repo?: string
  revision?: string
  symbols: Record<string, { behavior: Behavior; evidence?: Record<string, string> }>
}

/** Join a sidecar to its model. Returns how many declarations received facts; a sidecar of another revision gives none. */
export function attachBehavior(model: ApiModelBase, sidecar: BehaviorSidecar): number {
  if (!model.revision || sidecar.revision !== model.revision) return 0
  let attached = 0
  for (const symbol of model.symbols) {
    const entry = sidecar.symbols[symbol.publicId ?? symbol.id]
    if (!entry) continue
    symbol.behavior = entry.behavior
    attached++
  }
  return attached
}
