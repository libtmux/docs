/**
 * Typed access to the generated registry state.
 *
 * `site/src/data/registry.json` is written by `scripts/gen-registry.mjs` and
 * says what each port's package registry carries today: a stable release, a
 * prerelease only, or nothing at all. `ports.ts` owns the install *spellings*
 * and stays importable by bare Node for `build-site.sh`, which is why it takes
 * a `RegistryEntry` as an argument rather than importing this.
 *
 * The cast is the reason this file exists rather than each caller importing
 * the JSON. TypeScript infers `status: string` from the literal, which does
 * not satisfy `RegistryStatus`, so every consumer would repeat the same
 * assertion and could drift on how it handles a missing port.
 */
import data from '../data/registry.json'
import { installCommand, releaseWording, type InstallForm, type Port, type RegistryData, type RegistryEntry } from './ports'
import { portParts, type PortParts, type PromptContext } from './prompts'

export const REGISTRY = data as RegistryData

/**
 * One port's registry state.
 *
 * Throws rather than returning a default. A port present in `ports.ts` and
 * absent from the generated data means the generator has not been run since
 * the port was added, and every install command and prompt for it would
 * otherwise be silently composed from a guess.
 */
export function registryFor(port: Port | string): RegistryEntry {
  const slug = typeof port === 'string' ? port : port.slug
  const entry = REGISTRY.ports[slug]
  if (!entry) {
    throw new Error(`registry.json has no entry for port "${slug}"; run node scripts/gen-registry.mjs`)
  }
  return entry
}

/** The install command that resolves today, for a port. */
export function installFor(port: Port): InstallForm {
  return installCommand(port, registryFor(port))
}

/**
 * Everything `portParts` needs about a port, gathered once.
 *
 * The widget, the three prompt routes and the test suite all need the same
 * four values, and three of them are derived. Gathering them here keeps
 * `prompts.ts` free of value imports, which is what lets the browser share its
 * compose function, while giving every server-side caller one way to reach it.
 */
export function promptInputs(port: Port, ctx: PromptContext) {
  const entry = registryFor(port)
  return {
    port,
    entry,
    install: installCommand(port, entry),
    wording: releaseWording(port, entry),
    ctx,
  }
}

/** One port's prompt parts, for a caller that has a context. */
export function promptPartsFor(port: Port, ctx: PromptContext): PortParts {
  return portParts(promptInputs(port, ctx))
}
