import data from '../data/product-copy.json'
import { PORT_BY_SLUG } from './ports'

/**
 * What the Workspace and MCP product pages call themselves, and the sentence
 * that opens each.
 *
 * The titles are a form of the language's name. The introduction is built from
 * `data/product-copy.json` alone, which `scripts/gen-product-copy.mjs` reads
 * from each port's own files: a port is described as having a verb, a format
 * or an SDK only when the data says it does, and the data says so only where
 * the port's files show it.
 */

export type CopyProduct = 'workspace' | 'mcp'

interface WorkspaceClaims { verbs: string[]; formats: string[]; formatNote?: string }
interface McpClaims { sdk?: { name: string; href: string }; protocol?: { name: string; href: string } }

const WORKSPACE = (data as unknown as { workspace: Record<string, WorkspaceClaims> }).workspace
const MCP = (data as unknown as { mcp: Record<string, McpClaims> }).mcp

/** The language's proper name, as the port page spells it. */
const languageOf = (port: string) => PORT_BY_SLUG[port]!.name

/** The page's title: `tmux workspace manager, forged in Rust`. */
export const workspaceTitle = (port: string) => `tmux workspace manager, forged in ${languageOf(port)}`

/** The form for a tab, a meta tag and a list: `Rust-based tmux workspace manager`. */
export const workspaceShortTitle = (port: string) => `${languageOf(port)}-based tmux workspace manager`

/** The page's title: `tmux MCP, built in Rust`. It serves the tab too. */
export const mcpTitle = (port: string) => `tmux MCP, built in ${languageOf(port)}`

/** A run of text, or a link inside it. */
export type IntroPart = string | { text: string; href: string }

/** The introduction as the plain text a reader hears and a test compares. */
export const introText = (parts: readonly IntroPart[]) => parts.map((part) => (typeof part === 'string' ? part : part.text)).join('')

/** `Load`, `Load and freeze`, `Load, freeze, and convert`. */
function verbPhrase(verbs: readonly string[]): string {
  const words = verbs.map((verb, index) => (index === 0 ? `${verb[0]!.toUpperCase()}${verb.slice(1)}` : verb))
  if (words.length < 3) return words.join(' and ')
  return `${words.slice(0, -1).join(', ')}, and ${words.at(-1)}`
}

/** Whether a port has a workspace introduction, which a port with no published tool does not. */
export const hasWorkspaceIntro = (port: string) => Object.hasOwn(WORKSPACE, port)
export const hasMcpIntro = (port: string) => Object.hasOwn(MCP, port)

/**
 * The workspace page's opening, before the picker: what the tool does, with
 * only the verbs and formats the port has, and a link to the library it is
 * built on.
 */
export function workspaceIntro(port: string, coreHref: string): IntroPart[] | undefined {
  const claims = WORKSPACE[port]
  if (!claims) return undefined
  return [
    `Session manager for tmux. ${verbPhrase(claims.verbs)} tmux sessions through ${claims.formats.join('/')} configuration files. `,
    ...(claims.formatNote ? [`${claims.formatNote} `] : []),
    'Powered by ',
    { text: `libtmux for ${languageOf(port)}`, href: coreHref },
    '.',
  ]
}

/**
 * The MCP page's opening, before the install steps.
 *
 * `grouped` is whether the server selects its tools by group and enforces the
 * selection: a server that only takes a list of tools does not say it groups.
 */
export function mcpIntro(port: string, coreHref: string, { grouped }: { grouped: boolean }): IntroPart[] | undefined {
  const claims = MCP[port]
  if (!claims) return undefined
  const library: IntroPart = { text: `libtmux for ${languageOf(port)}`, href: coreHref }
  const builtOn: IntroPart[] = claims.sdk
    ? ['tmux terminal control for AI agents, built on ', library, ' and ', { text: claims.sdk.name, href: claims.sdk.href }, '.']
    : ['tmux terminal control for AI agents, built on ', library, ' with its own implementation of the ', { text: claims.protocol!.name, href: claims.protocol!.href }, '.']
  const hierarchy = ' This server maps tmux\'s object hierarchy — sessions, windows, panes — into MCP tools'
  return [
    ...builtOn,
    grouped
      ? `${hierarchy} grouped by the operation they request. The server enforces the selected groups at the MCP tool boundary.`
      : `${hierarchy}. It offers only the tools selected when it starts.`,
  ]
}
