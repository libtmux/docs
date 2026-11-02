/**
 * Typed access to the generated registry state.
 *
 * `site/src/data/registry.json` is written by `scripts/gen-registry.mjs` and
 * says what each port's package registry carries today: a final release, a
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
import { installCommand, isReleaseSeries, releaseMaturity, releaseWording, type InstallCommand, type InstallForm, type Port, type RegistryData, type RegistryEntry } from './ports'
import { wrapShell } from './install-matrix'
import { releaseTag } from './versions'
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

/** Select an install revision without borrowing another port's build identity. */
export function installSelection(
  port: Port,
  sources: readonly { product: string; package: string; version?: string }[] = [],
  env: Record<string, string | undefined> = {},
): { version?: string; pin?: boolean; revision?: string } {
  if (port.slug === 'julia' && env.LIBTMUX_DOCS_PORT === port.slug && env.LIBTMUX_DOCS_SOURCE_SHA) {
    const revision = env.LIBTMUX_DOCS_SOURCE_SHA
    if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Julia installation requires the documented source SHA')
    return { revision }
  }
  if (port.slug !== 'csharp' && port.slug !== 'fsharp') return {}
  const selected = env.LIBTMUX_DOCS_PORT === port.slug
    ? releaseTag(env.LIBTMUX_DOCS_VERSION ?? '', port) : null
  return {
    version: selected?.replace(/^v/, '') ?? sources.find((source) => source.product === 'core' && source.package === port.packageName)?.version,
    pin: selected !== null,
  }
}

/** Resolve package snippets against the selected docs source or registry snapshot. */
export function installsFor(port: Port, selection: { version?: string; pin?: boolean; revision?: string } = {}): readonly InstallCommand[] {
  if (port.installs.some((command) => command.code.includes('{revision}'))) {
    const revision = JSON.stringify(selection.revision ?? port.source?.ref ?? 'HEAD')
    return port.installs.map((command) => ({ ...command, code: command.code.replaceAll('{revision}', revision) }))
  }
  if (!port.installs.some((command) => command.code.includes('{version}') || command.additionalBlocks?.some((block) => block.code.includes('{version}')))) return port.installs
  const entry = registryFor(port)
  const version = selection.version ?? entry.version
  const fill = (code: string) => code.replaceAll('{version}', version!)
  if (!version) {
    const source = installCommand(port, entry)
    return [{ label: 'Source', ...source, code: source.lang === 'console' ? wrapShell(source.code) : source.code }]
  }
  return port.installs.map((command) => ({
    ...command,
    code: fill(selection.pin && command.versionedCode ? command.versionedCode : command.code),
    additionalBlocks: command.additionalBlocks?.map((block) => ({ ...block, code: fill(block.code) })),
  }))
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
    released: isReleaseSeries(releaseMaturity(entry)),
    install: installCommand(port, entry),
    wording: releaseWording(port, entry),
    ctx,
  }
}

/** One port's prompt parts, for a caller that has a context. */
export function promptPartsFor(port: Port, ctx: PromptContext): PortParts {
  return portParts(promptInputs(port, ctx))
}
