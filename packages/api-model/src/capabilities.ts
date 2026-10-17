/**
 * Capability manifests: what each port's typed `support.capabilities` registry
 * says it can do on each tmux release, as the port itself serializes it.
 *
 * A port never writes this file by hand. Its own build emits it from the
 * registry the library refuses with, and its own drift test fails when the
 * two disagree. The site reads the manifest from the same checkout and
 * revision as that port's API model, resolves every API name in it through
 * the model, and computes each table cell from the release fields. Nothing
 * here is a list somebody keeps in step.
 */

export const CAPABILITY_SCHEMA = 'libtmux-capabilities/1'

/** A tmux command, and the flags of it a capability depends on. */
export interface CapabilityCommand {
  command: string
  flags?: string[]
}

/** How a library behaves where the capability is not available. */
export type Handling = 'refuse' | 'fallback' | 'repair'

/** One positive capability, as the port's registry declares it. */
export interface CapabilityEntry {
  /** Stable id shared by every port (`control-mode`, `buffer-delete-named`). */
  id: string
  /** Short name for headings. */
  name: string
  /** One sentence: what a caller can do with it. */
  summary: string
  /** The first tmux release it works on. */
  since: string
  /** Exact releases at or above `since` where it does not work. */
  except?: string[]
  /** What the library does below `since` or on an excepted release. */
  handling: Handling
  /** The API name of the error a refusal raises. Required when `handling` is `refuse`. */
  error?: string
  /** Public API names that need this capability, as the port's API model names them. */
  apis: string[]
  /** tmux commands the capability concerns. */
  commands: CapabilityCommand[]
}

/** A release-specific defect the library works around. Not a capability. */
export interface Workaround {
  id: string
  name: string
  summary: string
  /** Exact releases the workaround applies to. */
  releases: string[]
  handling: Exclude<Handling, 'fallback'>
  apis: string[]
  commands: CapabilityCommand[]
}

/** The floor from the port's `support.versions`. */
export interface Floor {
  minimum: string
}

export interface CapabilityManifest {
  schema: typeof CAPABILITY_SCHEMA
  /** The site's port slug. */
  port: string
  floor: Floor
  capabilities: CapabilityEntry[]
  workarounds: Workaround[]
}

/** A version tmux has printed: `X.Y`, `X.Ya`, `X.Y-rc`, `X.Y-rcN` or `next-X.Y`. */
const VERSION = /^(?:next-(0|[1-9]\d*)\.(0|[1-9]\d*)|(0|[1-9]\d*)\.(0|[1-9]\d*)([a-z]?)(?:-rc(\d*))?)$/

/** A sortable key in tmux's own order: next-X.Y < X.Y-rc < X.Y-rcN < X.Y < X.Ya. */
export function tmuxVersionKey(version: string): number[] {
  const m = VERSION.exec(version)
  if (!m) throw new TypeError(`not a version tmux prints: ${JSON.stringify(version)}`)
  if (m[1] !== undefined) return [Number(m[1]), Number(m[2]), 0, 0, 0]
  const letter = m[5] ? m[5].charCodeAt(0) - 96 : 0
  if (m[6] !== undefined) {
    if (letter) throw new TypeError(`a candidate carries no patch letter: ${JSON.stringify(version)}`)
    return [Number(m[3]), Number(m[4]), 1, m[6] === '' ? 0 : Number(m[6]), 0]
  }
  return [Number(m[3]), Number(m[4]), 2, 0, letter]
}

export function compareTmuxVersions(a: string, b: string): number {
  const ka = tmuxVersionKey(a)
  const kb = tmuxVersionKey(b)
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]
  return 0
}

/** What a library does with a capability on one release. */
export type CellState = 'supported' | 'workaround' | 'fallback' | 'refused' | 'repaired'

export function capabilityState(entry: CapabilityEntry, release: string): CellState {
  const available = compareTmuxVersions(release, entry.since) >= 0 && !(entry.except ?? []).includes(release)
  if (available) return 'supported'
  if (entry.handling === 'fallback') return 'fallback'
  if (entry.handling === 'repair') return 'repaired'
  return 'refused'
}

export function workaroundState(entry: Workaround, release: string): CellState {
  if (!entry.releases.includes(release)) return 'supported'
  return entry.handling === 'repair' ? 'workaround' : 'refused'
}

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

function isString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function checkVersion(errors: string[], where: string, v: unknown): void {
  if (!isString(v)) {
    errors.push(`${where}: expected a tmux version`)
    return
  }
  try {
    tmuxVersionKey(v)
  } catch (e) {
    errors.push(`${where}: ${(e as Error).message}`)
  }
}

function checkCommands(errors: string[], where: string, v: unknown): void {
  if (!Array.isArray(v)) {
    errors.push(`${where}: expected an array of commands`)
    return
  }
  v.forEach((c, i) => {
    if (!c || typeof c !== 'object' || !isString((c as CapabilityCommand).command)) {
      errors.push(`${where}[${i}]: expected { command, flags? }`)
      return
    }
    const flags = (c as CapabilityCommand).flags
    if (flags !== undefined && (!Array.isArray(flags) || !flags.every((f) => /^-[A-Za-z]$/.test(f)))) {
      errors.push(`${where}[${i}].flags: expected single-letter flags such as "-b"`)
    }
  })
}

function checkNames(errors: string[], where: string, v: unknown): void {
  if (!Array.isArray(v) || !v.every(isString)) errors.push(`${where}: expected an array of API names`)
}

/**
 * Validate a manifest without a schema library. Every problem is reported, so
 * a port fixing its emitter sees the whole list at once.
 */
export function validateManifest(value: unknown): { manifest?: CapabilityManifest; errors: string[] } {
  const errors: string[] = []
  const m = value as Partial<CapabilityManifest> | null
  if (!m || typeof m !== 'object') return { errors: ['manifest: expected an object'] }
  if (m.schema !== CAPABILITY_SCHEMA) errors.push(`schema: expected "${CAPABILITY_SCHEMA}"`)
  if (!isString(m.port)) errors.push('port: expected the site port slug')
  checkVersion(errors, 'floor.minimum', m.floor?.minimum)
  const ids = new Set<string>()
  const seen = (where: string, id: unknown) => {
    if (!isString(id) || !ID.test(id)) errors.push(`${where}.id: expected a kebab-case id`)
    else if (ids.has(id)) errors.push(`${where}.id: "${id}" appears twice`)
    else ids.add(id)
  }
  if (!Array.isArray(m.capabilities)) errors.push('capabilities: expected an array')
  else {
    m.capabilities.forEach((c, i) => {
      const at = `capabilities[${i}]`
      seen(at, c?.id)
      if (!isString(c?.name)) errors.push(`${at}.name: expected a name`)
      if (!isString(c?.summary)) errors.push(`${at}.summary: expected a sentence`)
      checkVersion(errors, `${at}.since`, c?.since)
      ;(c?.except ?? []).forEach((r, j) => checkVersion(errors, `${at}.except[${j}]`, r))
      if (!['refuse', 'fallback', 'repair'].includes(c?.handling as string)) errors.push(`${at}.handling: expected refuse, fallback or repair`)
      if (c?.handling === 'refuse' && !isString(c?.error)) errors.push(`${at}.error: a refusal names its error type`)
      checkNames(errors, `${at}.apis`, c?.apis)
      checkCommands(errors, `${at}.commands`, c?.commands)
    })
  }
  if (!Array.isArray(m.workarounds)) errors.push('workarounds: expected an array')
  else {
    m.workarounds.forEach((w, i) => {
      const at = `workarounds[${i}]`
      seen(at, w?.id)
      if (!isString(w?.name)) errors.push(`${at}.name: expected a name`)
      if (!isString(w?.summary)) errors.push(`${at}.summary: expected a sentence`)
      if (!Array.isArray(w?.releases) || w.releases.length === 0) errors.push(`${at}.releases: expected at least one release`)
      else w.releases.forEach((r, j) => checkVersion(errors, `${at}.releases[${j}]`, r))
      if (!['refuse', 'repair'].includes(w?.handling as string)) errors.push(`${at}.handling: expected refuse or repair`)
      checkNames(errors, `${at}.apis`, w?.apis)
      checkCommands(errors, `${at}.commands`, w?.commands)
    })
  }
  return errors.length ? { errors } : { manifest: m as CapabilityManifest, errors }
}
