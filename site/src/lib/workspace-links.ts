import data from '../data/workspace-entities.json'
import { PORT_BY_SLUG, portPageUrl, productApiPath } from './ports'
import { linkedVersionFor } from './versions'
import type { Mention } from './tmux-links'

export type WorkspaceEntityKind = 'command' | 'option' | 'key'

/** One generated group: the ports it serves share these CLI Manual and Configuration entries. */
interface Group {
  ports: string[]
  program: string
  /** Name, route below the port root, and whether the CLI Manual's index lists it. */
  commands: [string, string, boolean][]
  options: [string, string, string][]
  keys: [string, string, string][]
}

interface Location { path: string; anchor?: string }
interface PortEntities {
  program: string
  commands: Map<string, Location & { listed: boolean }>
  options: Map<string, Location[]>
  keys: Map<string, Location[]>
}

const entities = new Map<string, PortEntities>()

function many(rows: [string, string, string][]): Map<string, Location[]> {
  const map = new Map<string, Location[]>()
  for (const [name, path, anchor] of rows) map.set(name, [...(map.get(name) ?? []), { path, anchor }])
  return map
}

/** What a port's CLI Manual and Configuration reference define; nothing for a port without them. */
function portEntities(port: string): PortEntities | undefined {
  if (!entities.size) {
    for (const group of (data as { groups: Group[] }).groups) {
      const parsed: PortEntities = {
        program: group.program,
        commands: new Map(group.commands.map(([name, path, listed]) => [name, { path, listed }])),
        options: many(group.options),
        keys: many(group.keys),
      }
      for (const slug of group.ports) entities.set(slug, parsed)
    }
  }
  return entities.get(port)
}

/**
 * The program that loads a workspace file and the CLI Manual page that documents
 * `load`, for a port whose manual lists the command; nothing for a port without one.
 */
export function loadCommand(port: string): { program: string; path: string } | undefined {
  const entity = portEntities(port)
  const load = entity?.commands.get('load')
  return entity && load ? { program: entity.program, path: load.path } : undefined
}

/**
 * The one place a workspace name becomes a destination: its page in the port's
 * CLI Manual or Configuration reference, at the table row that defines it.
 */
export function workspaceEntityHref(port: string, location: Location, version = linkedVersionFor(port)): string {
  return `${portPageUrl(PORT_BY_SLUG[port]!, version, location.path)}${location.anchor ? `#${location.anchor}` : ''}`
}

/**
 * Pages about the workspace library rather than its CLI. There `freeze` is the
 * function and `options` the field, so only `<program> <command>` names a command.
 */
export function isLibraryPage(route: string | undefined, group?: string): boolean {
  return route?.startsWith('workspace/internals') === true || group === 'Internals' || route === productApiPath('workspace')
}

export interface WorkspaceContext {
  /** The port whose workspace documentation the names belong to. */
  port: string
  /** The page's route below the port root, such as `workspace/cli/load`. */
  route?: string
  /** A bare `load` or `start_directory` names a workspace entity only on a workspace page. */
  bare: boolean
  /** The span is the first cell of a table row; a name does not link to its own definition. */
  definition?: boolean
  version?: string
}

const OPTION = /^-{1,2}[A-Za-z0-9][\w-]*$/
const optionTokens = (text: string, from: number) =>
  [...text.slice(from).matchAll(/(?<![\w-])-{1,2}[A-Za-z0-9][\w-]*/g)].map((match) => ({ name: match[0], start: from + match.index }))

export interface WorkspaceNames {
  mentions: Mention[]
  /** The span names an entry that this very place defines, so nothing else should claim it. */
  defined: boolean
}

/**
 * Locate the workspace commands, options and configuration keys a code span names.
 *
 * `<program> <command>` is unambiguous on any page. A bare command, option or
 * key is only evidence on a workspace page, where `load` and `shell` are CLI
 * commands and `window_name` is a key rather than a library symbol or a tmux
 * format variable of the same name.
 */
export function workspaceNames(text: string, context: WorkspaceContext): WorkspaceNames {
  const known = portEntities(context.port)
  const found: Mention[] = []
  let defined = false
  if (!known || !text) return { mentions: found, defined }
  const version = context.version ?? linkedVersionFor(context.port)
  const here = context.route?.replace(/^\/+|\/+$/g, '')
  const mention = (kind: WorkspaceEntityKind, name: string, location: Location, start: number, end: number, extra: Partial<Mention> = {}): Mention =>
    ({ start, end, text: text.slice(start, end), kind, name, href: workspaceEntityHref(context.port, location, version), family: 'workspace', ...extra })
  const commandAt = (path: string) => [...known.commands].find(([, location]) => location.path === path)?.[0]

  // Options belong to the command that precedes them, or to the options every command accepts.
  const optionsAfter = (command: Location, from: number) => optionTokens(text, from).flatMap(({ name, start }) => {
    const rows = known.options.get(name)
    const row = rows?.find((location) => location.path === command.path) ?? rows?.find((location) => location.path === 'workspace/cli')
    const owner = row && commandAt(row.path)
    return row ? [mention('option', name, row, start, start + name.length,
      { inline: true, title: `${known.program} ${owner ? `${owner} ` : ''}option` })] : []
  })

  // A command's own page does not link back to itself.
  const commandMention = (name: string, command: Location, end: number): Mention[] => {
    defined ||= command.path === here
    return command.path === here ? [] : [mention('command', name, command, 0, end, { title: `${known.program} command` })]
  }

  const lead = /^(\S+)\s+/.exec(text)
  if (lead?.[1] === known.program) {
    const rest = text.slice(lead[0].length)
    const [name, command] = [...known.commands].filter(([candidate]) => rest === candidate || /^\s/.test(rest.slice(candidate.length)) && rest.startsWith(candidate))
      .sort((a, b) => b[0].length - a[0].length)[0] ?? []
    if (name && command) {
      const end = lead[0].length + name.length
      found.push(...commandMention(name, command, end), ...optionsAfter(command, end))
    }
    return { mentions: found, defined }
  }
  if (!context.bare) return { mentions: found, defined }

  const word = /^[\w-]+/.exec(text)?.[0]
  const command = word ? known.commands.get(word) : undefined
  const key = /^"([A-Za-z_]\w*)"$/.exec(text)?.[1] ?? /^[A-Za-z_]\w*/.exec(text)?.[0]
  const keyRows = key ? known.keys.get(key) : undefined
  const quoted = text.startsWith('"')
  const wholeKey = key !== undefined && (text === key || quoted)
  const keyColon = key !== undefined && text.startsWith(`${key}:`) && /^\s|^$/.test(text.slice(key.length + 1))

  // A name that is both a command and a key follows the section it sits in.
  const section = here?.startsWith('workspace/cli') ? 'command' : here?.startsWith('workspace/configuration') ? 'key' : undefined
  const asCommand = command?.listed && word && (text === word || /^\s+-/.test(text.slice(word.length)))
  const asKey = keyRows && (wholeKey || keyColon)
  const preferKey = section === 'key' || (section === undefined && quoted)

  if (asCommand && !(asKey && preferKey)) {
    found.push(...commandMention(word, command, word.length), ...optionsAfter(command, word.length))
  } else if (asKey) {
    const row = keyRows.find((location) => location.path === here) ?? keyRows[0]
    defined = Boolean(context.definition) && row.path === here
    if (!defined) {
      found.push(keyColon && !wholeKey
        ? mention('key', key, row, 0, key.length, { inline: true, title: 'workspace configuration key' })
        : mention('key', key, row, 0, text.length, { title: 'workspace configuration key' }))
    }
  } else if (here !== undefined && OPTION.test(text.split(/\s+/)[0] ?? '')) {
    // An option named on the page that defines it, or on any command page for one every command accepts.
    const name = text.split(/\s+/)[0]!
    const rows = known.options.get(name)
    const row = rows?.find((location) => location.path === here) ?? (here.startsWith('workspace/cli/') ? rows?.find((location) => location.path === 'workspace/cli') : undefined)
    defined = Boolean(row && context.definition && row.path === here)
    if (row && !defined) {
      const owner = commandAt(row.path)
      found.push(mention('option', name, row, 0, name.length, { title: `${known.program} ${owner ? `${owner} ` : ''}option` }))
    }
  }
  return { mentions: found, defined }
}

export const workspaceMentions = (text: string, context: WorkspaceContext): Mention[] => workspaceNames(text, context).mentions
