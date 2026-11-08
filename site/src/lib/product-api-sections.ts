/**
 * The sections of a product's API reference sidebar and index.
 *
 * Core references take their sections from each port's compiled navigation (`scripts/gen-api-model.mjs`). A product
 * (MCP, workspace) has no compiled navigation, so its sections come from one vocabulary shared by every port:
 * the first rule a declaration matches names its section, and a port overrides only what a rule misplaces. The
 * sections reach the page through the same `TreeBucket` shape the core tree uses.
 */
import type { ApiModel, ApiSymbol } from '@libtmux/api-model'
import { productApiRoots } from './product-api'
import { mcpToolSymbols } from './mcp-catalog'
import type { TreeBucket } from './api-tree'
import type { NavEntry } from './api-models'
import type { DocProduct } from './ports'

export interface ProductSection { id: string; label: string }

/** The shared vocabulary, in reading order. */
export const PRODUCT_SECTIONS: Record<'mcp' | 'workspace', ProductSection[]> = {
  mcp: [
    { id: 'tools', label: 'Tools' },
    { id: 'prompts', label: 'Prompts' },
    { id: 'resources', label: 'Resources and URIs' },
    { id: 'views', label: 'Views and results' },
    { id: 'server', label: 'Server and setup' },
    { id: 'configuration', label: 'Configuration and environment' },
    { id: 'errors', label: 'Errors' },
    { id: 'utilities', label: 'Utilities' },
  ],
  workspace: [
    { id: 'configuration', label: 'Workspace files' },
    { id: 'building', label: 'Building and freezing' },
    { id: 'cli', label: 'Command line' },
    { id: 'integrations', label: 'Plugins and shell' },
    { id: 'errors', label: 'Errors' },
    { id: 'utilities', label: 'Utilities' },
  ],
}

/** A product with fewer public roots than this is shorter than its own section headings. */
export const MIN_GROUPED_ROOTS = 8

interface Facts { name: string; kind: string; file: string; tool: boolean }
type Test = (facts: Facts) => boolean
type Rule = readonly [section: string, test: Test]

const name = (pattern: RegExp): Test => (facts) => pattern.test(facts.name)
const file = (pattern: RegExp): Test => (facts) => pattern.test(facts.file)
const either = (...tests: Test[]): Test => (facts) => tests.some((test) => test(facts))

const ERROR = either(name(/(?:Error|Exception|Errors)$|^Err[A-Z]|NotFound$|NotExists$|Missing$|UnknownFileType$/), file(/(?:^|\/)(?:exc|errors?)\.[a-z]+$/))

/** First match wins, so the narrow and certain rules come first. */
const MCP_RULES: Rule[] = [
  ['errors', ERROR],
  ['server', name(/Middleware$|^Builder$/)],
  ['resources', either(name(/(?:URI|Uri)$/), name(/^(?:capabilities|listed|templates)$/), name(/^CapabilityReport$/))],
  ['tools', (facts) => facts.tool],
  ['prompts', file(/prompts\/recipes\.py$/)],
  // Tool selection configures which tools exist; it is not a tool.
  ['configuration', either(
    name(/(?:^|_)ENV(?:_|$)|EnvironmentVariable$|MetaKey$|^Toolsets?$|^TOOLSETS?_|Selection$|_selection$|^(?:configured|default)_tools$|^environment_values|^parse_environment/),
    name(/^(?:DEFAULT|MAX|SHOW|SEARCH|CAPTURE|HISTORY|PANE_STATE|SOCKET|ENV|RETIRED)_|_DEFAULT_|Policy$|Configuration$|Provenance$|^Materialize|^kSchemaVersion$|^Reporter$/),
    file(/(?:^|\/)(?:policy|configuration|startup|tool_surface|minimal_config|filter_json)\.[a-z]+$/))],
  ['tools', either(
    name(/Args$|Arguments$|^Argument|^Tool[A-Z]|^Advertised|^Parameter$|^Effect$|^Handler$|^Output(?:Class|Shape)$|^Input(?:Sink|Control)$|^ProcessReach$|^Tmux(?:Effect|FormatControl|Tools)$|^NestedAuthority$|^Sink$|^kConservativeAnnotations$|^Structured|Call$|CallContext$/),
    file(/(?:^|\/)(?:tool_catalog|ToolCatalog)\.[a-z]+$|tools\/contract\.rs$/))],
  ['views', either(
    file(/(?:^|\/)(?:views|models?|Observations|Entities|tail|exec|ReadTools\.Inspect|WriteTools\.Input|BoundedText)\.[a-z]+$/),
    name(/(?:Result|Results|View|Info|Snapshot|Entry|Outcome|Ref|Content|Operation|Match)$/))],
  ['server', either(
    name(/^(?:build_mcp_server|run_server|run|main|serve|install_cli|install_\w+|register(?:_\w+)?|create\w*Server|serverFromEnvironment|NewServer|Run\w*|Version|HELP|mcp|Options|Stop|Application|Instance|ServerSession|Main|Relation|ServerState|ServerStartup|ServerInstructions|Handshake\w*|AssumeResponseCommit|ProgressReporter|ModelContextProtocol\.\w+|Base\.\w+|Caller\w*|MCP\w*|LibTmux\w+|\w*Server\w*|\w*Composition|\w*Accessor)$/),
    file(/(?:^|\/)(?:server|cli|main|lib|caller|Caller|instance|runtime|stdio|adapter|MCPProtocol|Serve|Progress|response_transport|handshake_transport)\.[a-z]+$/))],
  ['utilities', () => true],
]

const WORKSPACE_RULES: Rule[] = [
  ['errors', ERROR],
  ['cli', either(
    name(/^CLI|^command_|subparser$|_DESCRIPTION$|^create_parser$|^install_cli$|^main$|^cli$|^ns$|^startup$|^prompt|^WorkspaceInfo$/),
    file(/(?:^|\/)cli(?:\/|_\w+\.|\.)/))],
  ['integrations', either(name(/^Tmuxp(?:Plugin|LoggerAdapter)$/), file(/(?:^|\/)(?:plugin|shell)\.py$/))],
  ['building', either(
    name(/^(?:Build|BuildInto|build|apply|plan|freeze|claim|may|owned)\w*$/i),
    name(/Builder\w*$|^Workspace(?:Plan|Action|Result|Apply|Host|Existing|Readiness|ServerStartup|Retention|PaneCreation|Window(?:Creation|Removal|Rename|Placement)|PaneRemoval)|^(?:Apply|Plan)Workspace|PrunePolicy|CommandPolicy|Milestone$|Stage$|^run_before_script$|ScriptResult$|^Expanded/),
    file(/(?:^|\/)(?:builder|freeze|freezer|planning|plan|apply|script|ownership|operation_options|registry|classic|protocol|WorkspaceAction\w*|WorkspacePlan|WorkspaceResult|WorkspaceBuilder|WorkspaceHostCommand|WorkspaceOperation\w*)\.[a-z]+$|\/builder\//))],
  ['configuration', either(
    name(/^(?:Workspace|Parse|parse|Resolve|Pane|Window|Command|Bool|ShellCommand|\w*Config)\w*$|^(?:optionValue|paneCommands|paneStartDirectory|paneWantsFocus|windowStartDirectory|initialPaneStartDirectory)$/),
    file(/(?:^|\/)(?:config|workspace|command|WorkspaceFile|WorkspaceCommand|mod|loader|finders|validation|options|constants|importers|parser)\.[a-z]+$|\/config\//))],
  ['utilities', () => true],
]

/** Where a port's rules misplace a symbol, keyed by name. A test asserts every entry. */
export const PRODUCT_SECTION_OVERRIDES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'py:mcp': { PaneCorner: 'views' },
  'rs:mcp': { VariablesValue: 'views' },
  'swift:mcp': { JSONValue: 'utilities' },
  'julia:mcp': { tools: 'tools' },
  'julia:workspace': { LibTmuxWorkspace: 'building' },
}

const sectionOf = (port: string, product: 'mcp' | 'workspace', facts: Facts): string =>
  PRODUCT_SECTION_OVERRIDES[`${port}:${product}`]?.[facts.name]
  ?? (product === 'mcp' ? MCP_RULES : WORKSPACE_RULES).find(([, test]) => test(facts))![0]

/** Each root's section id; the same symbols and rules always give the same answer. */
export function productApiSectionIds(model: ApiModel, product: DocProduct, roots: ApiSymbol[] = productApiRoots(model, product)): Map<string, string> {
  if (product !== 'mcp' && product !== 'workspace') return new Map()
  const tools = new Set(product === 'mcp' ? mcpToolSymbols(model.port, model.symbols).map((symbol) => symbol.id) : [])
  return new Map(roots.map((symbol) => [symbol.id, sectionOf(model.port, product, {
    name: symbol.name, kind: symbol.kind, file: symbol.source?.file ?? '', tool: tools.has(symbol.id),
  })]))
}

/** Roots by section, in vocabulary order, each A-Z; an empty section is left out. Undefined when the product stays flat. */
export function productApiSections(model: ApiModel, product: DocProduct): { section: ProductSection; symbols: ApiSymbol[] }[] | undefined {
  if (product !== 'mcp' && product !== 'workspace') return undefined
  const roots = productApiRoots(model, product)
  if (roots.length < MIN_GROUPED_ROOTS) return undefined
  const ids = productApiSectionIds(model, product, roots)
  const sections = PRODUCT_SECTIONS[product].map((section) => ({ section, symbols: roots.filter((symbol) => ids.get(symbol.id) === section.id) }))
    .filter((entry) => entry.symbols.length > 0)
  return sections.length > 1 ? sections : undefined
}

/** The same sections as tree buckets, for the API sidebar. */
export function productApiBuckets(model: ApiModel, product: DocProduct, entry: (symbol: ApiSymbol) => NavEntry): TreeBucket[] | undefined {
  return productApiSections(model, product)?.map(({ section, symbols }) => ({
    id: section.id, label: section.label, collapsed: false, children: [], entries: symbols.map(entry),
  }))
}
