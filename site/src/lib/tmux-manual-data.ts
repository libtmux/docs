/** Versioned tmux command syntax and manual text, extracted together. */
import { CONCEPTS, conceptsFor } from '@libtmux/api-model'
import pins from '../data/tmux/versions.json'
import v32 from '../data/tmux/3.2a.json'
import v37 from '../data/tmux/3.7c.json'
import { API_MODELS, referenceHref } from './api-models'
import { PORT_BY_SLUG } from './ports'
import { withPortRoot } from './site-root'
import { rowAnchor } from './row-anchors'

export type TmuxManual = typeof v37
export type TmuxCommand = TmuxManual['commands'][number]
export const TMUX_REPOSITORY = 'tmux/tmux'
export const TMUX_MANUALS: Record<string, TmuxManual> = { '3.2a': v32, '3.7c': v37 }
export const TMUX_VERSIONS = ['latest', ...pins.versions.map((pin) => pin.version)]

export function tmuxManual(version: string): TmuxManual {
  const reference = TMUX_MANUALS[version === 'latest' ? pins.latest : version]
  if (!reference) throw new Error(`Unknown tmux manual version: ${version}`)
  return reference
}

/** tmux belongs to the general documentation, outside each library's tree. */
export function buildsTmuxDocumentation(env: Record<string, string | undefined> = process.env): boolean {
  return !env.LIBTMUX_DOCS_PORT && (!env.LIBTMUX_DOCS_LOCALE || env.LIBTMUX_DOCS_LOCALE === 'en')
}

export function tmuxManualUrl(version = 'latest', command = ''): string {
  return withPortRoot(`/tmux/${version}/manual/${command ? `${command}/` : ''}`)
}

/** A command absent from an older release leads to that release's index. */
export function tmuxManualVersionUrl(version: string, command?: string): string {
  const exists = command === 'full' || tmuxManual(version).commands.some((entry) => entry.name === command)
  return tmuxManualUrl(version, exists ? command : undefined)
}

/** Retired command pages remain redirects, without entering the sitemap. */
export function isLegacyTmuxManualPath(pathname: string): boolean {
  const match = pathname.match(/\/tmux\/([^/]+)\/reference\/(.*?)\/?$/)
  if (!match || !TMUX_VERSIONS.includes(match[1])) return false
  return match[2] === 'manual'
    || tmuxManual(match[1]).commands.some((command) => command.name === match[2])
}

export function tmuxManualRoutes(): { version: string; slug?: string }[] {
  if (!buildsTmuxDocumentation()) return []
  return TMUX_VERSIONS.flatMap((version) => [
    { version }, { version, slug: 'full' },
    ...tmuxManual(version).commands.map((command) => ({ version, slug: command.name })),
  ])
}

/** Keep cross-references in the selected version and any preview prefix. */
export function tmuxManualHtml(html: string, version: string): string {
  const reference = tmuxManual(version)
  return html.replaceAll(`/tmux/${reference.version}/manual/`, tmuxManualUrl(version))
}

export function tmuxManualTitle(version: string, slug?: string): string {
  return slug === 'full' ? `tmux ${tmuxManual(version).version} manual`
    : slug ? `tmux ${slug}` : 'tmux manual'
}

export function tmuxManualDescription(version: string, slug?: string): string {
  const reference = tmuxManual(version)
  return reference.commands.find((command) => command.name === slug)?.summary
    ?? `Command syntax and behavior for tmux ${reference.version}.`
}

// These concepts differ by target scope, while tmux uses flags on one command.
const scopedConcepts: Record<string, string[]> = {
  'split-window': ['split-pane'],
  'list-windows': ['list-server-windows'],
  'list-panes': ['list-session-panes', 'list-server-panes'],
}
const commandConcepts = (name: string) => [name, ...(scopedConcepts[name] ?? [])]
  .flatMap((key) => CONCEPTS[key] ? [CONCEPTS[key]] : [])

const guides = [
  { path: 'guides/getting-started', title: 'Start a tmux session', commands: ['new-session', 'list-sessions'] },
  { path: 'guides/attaching-to-tmux', title: 'Attach to an existing session', commands: ['attach-session', 'has-session'] },
  { path: 'guides/sending-keys', title: 'Send input to a pane', commands: ['send-keys', 'send-prefix'] },
  { path: 'guides/capturing-output', title: 'Capture pane output', commands: ['capture-pane', 'clear-history'] },
  { path: 'guides/querying-and-filtering', title: 'Find sessions, windows, and panes', commands: ['list-sessions', 'list-windows', 'list-panes', 'display-message'] },
  { path: 'guides/testing-with-libtmux', title: 'Test with an isolated server', commands: ['new-session', 'new-window', 'kill-server'] },
  { path: 'topics/options-and-hooks', title: 'Set options and hooks', commands: ['set-option', 'show-options', 'set-window-option', 'show-window-options', 'set-hook', 'show-hooks'] },
  { path: 'topics/waiting-and-retry', title: 'Wait for completion', commands: ['wait-for'] },
]

export function tmuxGuidesFor(command: string) {
  return guides.filter((guide) => guide.commands.includes(command))
    .map((guide) => ({ title: guide.title, href: withPortRoot(`/tmux/${guide.path}/`) }))
}

/** Link only declarations present in the integrated library models. */
export function tmuxApiLinks(command: string) {
  const seen = new Set<string>()
  return commandConcepts(command).flatMap((concept) => Object.entries(concept.symbols).flatMap(([port, id]) => {
    if (seen.has(port) || !API_MODELS[port]?.symbols.some((symbol) => (symbol.publicId ?? symbol.id) === id)) return []
    const href = referenceHref(port, id)
    if (!href) return []
    seen.add(port)
    return [{ name: PORT_BY_SLUG[port].name, href }]
  }))
}

/** Task-oriented notes complement the pinned manual; the native catalog gates flags. */
export function tmuxCommandNotes(version: string, slug?: string) {
  if (slug !== 'capture-pane') return undefined
  const command = tmuxManual(version).commands.find((entry) => entry.name === slug)!
  const flags = new Set([...command.usage.matchAll(/(?:^|[\s\[])-([A-Za-z]+)/g)].flatMap((match) => [...match[1]]))
  const groups = [
    { id: 'output-and-range', title: 'Output and line range', options: [
      { flag: 'p', label: '-p', text: 'Print to standard output. Without this flag, tmux saves the capture in a paste buffer.' },
      { flag: 'b', label: '-b name', text: 'Choose the paste buffer when -p is omitted. Without -b, tmux creates a new buffer.' },
      { flag: 't', label: '-t pane', text: 'Choose the pane to capture. Inside tmux, "$TMUX_PANE" identifies the current pane.' },
      { flag: 'S', label: '-S start', text: 'First line to capture. Zero is the first visible line; negative numbers reach into history. Use - for the start of history.' },
      { flag: 'E', label: '-E end', text: 'Last line to capture. Use a line number, or - for the end of the visible pane. By default, capture only the visible pane.' },
    ] },
    { id: 'text-formatting', title: 'Text formatting', options: [
      { flag: 'J', label: '-J', text: `Join wrapped lines and preserve trailing spaces.${flags.has('T') ? ' Implies -T.' : ''}` },
      { flag: 'e', label: '-e', text: 'Keep escape sequences for text attributes and colors.' },
      { flag: 'C', label: '-C', text: 'Escape non-printable characters as octal \\xxx sequences.' },
      { flag: 'N', label: '-N', text: 'Preserve trailing spaces at the end of each line.' },
      { flag: 'T', label: '-T', text: 'Ignore trailing positions that contain no character.' },
      { flag: 'H', label: '-H', text: 'Capture only hyperlink targets, separated by spaces when a line contains several.' },
      { flag: 'L', label: '-L', text: 'Prefix each line with its line number.' },
      { flag: 'F', label: '-F', text: 'Prefix each line with its flags: - none, D unused, O output, P prompt, X extended cells, H hyperlinks.' },
    ] },
    { id: 'screens-and-pending-output', title: 'Screens and pending output', options: [
      { flag: 'a', label: '-a', text: 'Capture the alternate screen instead of the normal screen. History is unavailable. Fails if no alternate screen exists.' },
      { flag: 'q', label: '-q', text: 'With -a, suppress the error when no alternate screen exists.' },
      { flag: 'M', label: '-M', text: 'Capture the mode screen, such as copy mode, when the pane is in a mode.' },
      { flag: 'P', label: '-P', text: 'Capture a received but incomplete escape sequence, rather than the pane contents.' },
    ] },
  ].map((group) => {
    const id = rowAnchor(rowAnchor(command.name, 'options'), group.title)
    return { ...group, id, legacyId: group.id, options: group.options.filter((option) => flags.has(option.flag))
      .map((option) => ({ ...option, id: rowAnchor(id, option.flag) })) }
  })
  return {
    context: 'Run these commands inside tmux, in the pane you want to capture. TMUX_PANE identifies that pane.',
    examples: [
      { title: 'Print the visible pane', code: 'tmux capture-pane -p -t "$TMUX_PANE"' },
      { title: 'Include up to 1,000 history lines and join wrapped lines', code: 'tmux capture-pane -p -J -S -1000 -t "$TMUX_PANE"' },
    ],
    groups,
  }
}

/** The same section identities drive the visible contents and agent manifest. */
export function tmuxManualHeadings(version: string, slug?: string) {
  const reference = tmuxManual(version)
  if (slug === 'full') return reference.sections.map((section) => ({ depth: 2, slug: section.id, text: section.title }))
  const notes = tmuxCommandNotes(version, slug)
  if (slug) return [
    ...(notes ? [{ depth: 2, slug: 'examples', text: 'Common uses' }] : []),
    { depth: 2, slug: 'syntax', text: 'Syntax' },
    { depth: 2, slug: 'behavior', text: notes ? 'Options' : 'Behavior' },
    ...(notes?.groups.map((group) => ({ depth: 3, slug: group.id, text: group.title })) ?? []),
    ...(tmuxGuidesFor(slug).length ? [{ depth: 2, slug: 'guides', text: 'Guides' }] : []),
    ...(tmuxApiLinks(slug).length ? [{ depth: 2, slug: 'libraries', text: 'Use from a library' }] : []),
  ].map((heading) => heading.depth === 2 ? { ...heading, slug: rowAnchor(slug, heading.text) } : heading)
  return [...new Set(reference.commands.map((entry) => entry.section))].map((section) => ({
    depth: 2, slug: section.toLowerCase().replaceAll(' ', '-'), text: section[0] + section.slice(1).toLowerCase(),
  }))
}

/** Match source-verified concepts to commands present in the selected manual. */
export function tmuxCommandsFor(port: string, publicId: string): TmuxCommand[] {
  const concepts = conceptsFor(port, publicId)
  return tmuxManual('latest').commands.filter((command) => commandConcepts(command.name).some((concept) => concepts.includes(concept)))
}
