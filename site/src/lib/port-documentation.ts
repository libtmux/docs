/** Reader-facing port domains and source-guide routes, separate from API products. */
import {
  DOC_PRODUCTS,
  PORT_BY_SLUG,
  portPageUrl,
  productAvailable,
  productIncluded,
  productDescription,
  type DocProduct,
  type PortPackageId,
} from './ports.ts'

export type DocumentationDomainKind = 'core' | 'companion-package' | 'runtime' | 'product' | 'unavailable'

export interface DocumentationDomain {
  id: string
  label: string
  description: string
  kind: DocumentationDomainKind
  navGroup: string
  /** Canonical path below a port/version root; `core` is the Core Library home. */
  route: string
  /** A published package only when installation metadata is meaningful. */
  package?: PortPackageId
  /** An API product only when the area owns an actual product surface. */
  product?: DocProduct
}

/** A source-owned page with a stable reader route and legacy path aliases. */
export interface PortSourceGuide {
  sourcePath: string
  /** Reader-facing metadata; the native source body and citation stay intact. */
  title?: string
  description?: string
  route: string
  aliases: readonly string[]
  /** Verified task counterpart; does not create a redirect or change its URL. */
  equivalence?: string
  domain: string
  package?: PortPackageId
  product?: DocProduct
  sidebar?: { group: string; label?: string; order?: number }
}

interface PortDocumentation {
  domains: readonly DocumentationDomain[]
  sourceGuides: readonly PortSourceGuide[]
  stagedSections?: readonly string[]
  /** Source directory relative to which native API comments write guide links. */
  apiDocRoot?: string
  redirects?: readonly { sourcePath: string; path: string; target: string }[]
  /** Section overviews to stage and offer when the shared operational sections do not apply. */
  sections?: Readonly<Record<string, string>>
}

const SECTION_DESCRIPTIONS: Readonly<Record<string, string>> = {
  guides: 'Connect to tmux and work with its sessions, windows, and panes.',
  examples: 'Run complete programs with their documented setup and cleanup.',
  topics: 'Understand object ownership, state, and operation behavior.',
  concepts: 'Understand captured queries, object identities, and operations.',
}

const guide = (
  sourcePath: string,
  route: string,
  domain: string,
  options: Omit<PortSourceGuide, 'sourcePath' | 'route' | 'domain' | 'aliases'> & { aliases?: readonly string[] } = {},
): PortSourceGuide => ({
  sourcePath,
  route,
  domain,
  aliases: options.aliases ?? [route.replace(/^(guides|examples)\//, '$1/source/')],
  ...options,
})

const libraryDomain = (description: string): DocumentationDomain => ({
  id: 'core', label: 'Library', kind: 'core', navGroup: 'Library', route: 'core', package: 'core', description,
})

const PORT_DOCUMENTATION: Readonly<Record<string, PortDocumentation>> = {
  ocaml: {
    stagedSections: ['guides'],
    domains: [
      libraryDomain('Immutable OCaml observations, typed queries and explicit native transports.'),
      { id: 'workspace', label: 'Workspace Manager', kind: 'product', navGroup: 'Apps', route: 'workspace', package: 'workspace', product: 'workspace',
        description: 'Validate, preview and apply JSON workspaces with retained execution receipts.' },
    ],
    sourceGuides: [
      ...['getting-started', 'bootstrap', 'graph', 'queries', 'query-interchange', 'control', 'recovery', 'streaming', 'showcases', 'packages', 'compatibility', 'testing', 'benchmarking', 'status'].map((name, index) =>
        guide(`docs/${name}.md`, `guides/${name}`, 'core', { aliases: [], sidebar: { group: 'Guides', order: index + 1 } })),
      guide('docs/workspaces.md', 'workspace/source-guide', 'workspace', { title: 'Workspace guide', product: 'workspace', package: 'workspace', aliases: [] }),
    ],
    redirects: [{ sourcePath: 'docs/api.md', path: 'guides/api', target: 'reference' }],
  },
  haskell: {
    domains: [
      libraryDomain('Parse tmux IDs, validate values and check stable releases with pure Haskell functions.'),
      { id: 'workspace', label: 'Workspace Manager', kind: 'unavailable', navGroup: 'Availability', route: 'workspace', product: 'workspace',
        description: 'The workspace library and CLI are planned as a separate Cabal package using the core.' },
      { id: 'mcp', label: 'MCP', kind: 'unavailable', navGroup: 'Availability', route: 'mcp', product: 'mcp',
        description: 'MCP is excluded from this port.' },
    ],
    sections: { guides: 'Install the source package, run the public values example, and understand the available API.' },
    sourceGuides: [
      guide('docs/README.md', 'guides/getting-started', 'core', { title: 'Getting started', sidebar: { group: 'Guides', order: 1 } }),
      guide('docs/installation.md', 'guides/installation', 'core', { title: 'Installation', sidebar: { group: 'Guides', order: 2 } }),
      guide('docs/values.md', 'guides/typed-values', 'core', { title: 'Typed values', sidebar: { group: 'Guides', order: 3 } }),
      guide('docs/api.md', 'guides/api-documentation', 'core', { title: 'API documentation', sidebar: { group: 'Guides', order: 4 } }),
      guide('docs/status.md', 'guides/status', 'core', { title: 'Implementation status', sidebar: { group: 'Guides', order: 5 } }),
    ],
  },
  perl: {
    domains: [
      libraryDomain('Use explicit tmux commands and captured graph selections with stable Perl.'),
      { id: 'async', label: 'Async', kind: 'companion-package', navGroup: 'Library', route: 'guides/async', package: 'async', description: 'Optional Future execution with a caller-owned IO::Async loop.' },
      { id: 'workspace', label: 'Workspace Manager', kind: 'product', navGroup: 'Apps', route: 'workspace', package: 'workspace', product: 'workspace', description: 'Validate, plan, and load versioned JSON workspaces through public core APIs.' },
    ],
    sourceGuides: [
      guide('README.md', 'guides/getting-started', 'core', { title: 'Getting started', sidebar: { group: 'Guides', order: 1 } }),
      guide('docs/installation.md', 'guides/installation', 'core', { title: 'Installation', sidebar: { group: 'Guides', order: 2 } }),
      guide('docs/filtering.md', 'guides/filtering', 'core', { title: 'Filtering' }),
      guide('docs/orchestration.md', 'examples/orchestration', 'core', { title: 'Create sessions, windows, and panes', aliases: ['guides/orchestration'] }),
      guide('docs/graph.md', 'concepts/graph', 'core', { title: 'Snapshot graph and identity', aliases: ['guides/graph'] }),
      guide('docs/fields.md', 'concepts/fields', 'core', { title: 'Entity fields', aliases: ['guides/fields'] }),
      guide('docs/query-planning.md', 'topics/query-planning', 'core', { title: 'Live query planning', aliases: ['guides/query-planning'] }),
      guide('docs/errors.md', 'topics/errors', 'core', { title: 'Errors and recovery', aliases: ['guides/errors'] }),
      guide('docs/compatibility.md', 'topics/compatibility', 'core', { title: 'Linux and tmux compatibility', aliases: ['guides/compatibility'] }),
      guide('docs/async.md', 'guides/async', 'async', { package: 'async', title: 'Optional async execution' }),
      guide('docs/workspace.md', 'workspace/source-guide', 'workspace', { package: 'workspace', product: 'workspace', title: 'Workspace guide', aliases: [] }),
    ],
  },
  lisp: {
    domains: [
      libraryDomain('Native CLOS observations, ordinary sequences and explicit tmux operations.'),
      { id: 'workspace', label: 'Workspace Manager', kind: 'product', navGroup: 'Apps', route: 'workspace', package: 'workspace', product: 'workspace',
        description: 'Validate, plan and explicitly apply bounded JSON workspaces through the native Lisp engine.' },
    ],
    sourceGuides: [
      guide('README.md', 'guides/getting-started', 'core', { title: 'Getting started', aliases: [], sidebar: { group: 'Guides', order: 1 } }),
      guide('docs/tutorial.md', 'guides/tutorial', 'core', { title: 'REPL tutorial', aliases: [], sidebar: { group: 'Guides', order: 2 } }),
      guide('docs/captures.md', 'concepts/captures', 'core', { title: 'Captures and identity', aliases: [], sidebar: { group: 'Concepts', order: 1 } }),
      guide('docs/queries.md', 'guides/queries', 'core', { title: 'Native queries', aliases: [], sidebar: { group: 'Guides', order: 3 } }),
      guide('docs/query-interchange.md', 'topics/query-interchange', 'core', { title: 'Query interchange', aliases: [], sidebar: { group: 'Topics', order: 1 } }),
      guide('docs/operations.md', 'guides/operations', 'core', { title: 'Explicit operations', aliases: [], sidebar: { group: 'Guides', order: 4 } }),
      guide('docs/transport.md', 'concepts/transport', 'core', { title: 'Transport and cleanup', aliases: [], sidebar: { group: 'Concepts', order: 2 } }),
      guide('docs/capabilities.md', 'guides/capabilities', 'core', { title: 'Capabilities and limits', aliases: [], sidebar: { group: 'Guides', order: 5 } }),
      guide('docs/testing.md', 'guides/testing', 'core', { title: 'Testing', aliases: [], sidebar: { group: 'Guides', order: 6 } }),
      guide('verification.md', 'guides/verification', 'core', { title: 'Verification evidence', aliases: [], sidebar: { group: 'Guides', order: 7 } }),
      guide('docs/workspaces.md', 'workspace/source-guide', 'workspace', { title: 'Workspace guide', product: 'workspace', package: 'workspace', aliases: [], sidebar: { group: 'Guides', order: 2 } }),
    ],
    redirects: [
      { sourcePath: 'docs/api.md', path: 'guides/api', target: 'reference' },
      { sourcePath: 'docs/query-api.md', path: 'guides/query-api', target: 'reference' },
      { sourcePath: 'docs/json-api.md', path: 'guides/json-api', target: 'reference' },
      { sourcePath: 'docs/workspace-api.md', path: 'workspace/api', target: 'workspace/reference' },
    ],
  },
  powershell: {
    domains: [
      libraryDomain('Install LibTmux and use cmdlets to read and control tmux.'),
      { id: 'workspace', label: 'Workspace Manager', kind: 'product', navGroup: 'Apps', route: 'workspace', package: 'workspace', product: 'workspace',
        description: 'Read, validate, plan and load workspace files with LibTmux.Workspace.' },
    ],
    sourceGuides: [
      guide('README.md', 'guides/getting-started', 'core', { title: 'Getting started', sidebar: { group: 'Guides', order: 1 } }),
      ...['read', 'query', 'create', 'remove', 'layout', 'placement', 'input', 'capture', 'commands', 'watch', 'clients', 'environment', 'options', 'hooks', 'compatibility', 'troubleshooting'].map((name) =>
        guide(`docs/${name}.md`, `guides/${name}`, 'core')),
      guide('docs/mcp.md', 'guides/mcp', 'core', { title: 'Using the .NET MCP server', aliases: ['mcp'] }),
      guide('docs/workspace.md', 'workspace/source-guide', 'workspace', { title: 'Workspace guide', product: 'workspace', package: 'workspace', aliases: [] }),
    ],
  },
  julia: {
    domains: [
      libraryDomain('Create or connect to tmux servers and work with captured state.'),
      { id: 'mcp', label: 'MCP', kind: 'product', navGroup: 'Apps', route: 'mcp', package: 'mcp', product: 'mcp',
        description: 'Configure the LibTmuxMCP stdio server and its tool permissions.' },
      { id: 'workspace', label: 'Workspace Manager', kind: 'product', navGroup: 'Apps', route: 'workspace', package: 'workspace', product: 'workspace',
        description: 'Read, validate, plan and load workspace files with LibTmuxWorkspace.' },
    ],
    sourceGuides: [
      guide('docs/src/index.md', 'guides/getting-started', 'core', { title: 'Getting started', sidebar: { group: 'Guides', order: 1 } }),
      guide('docs/src/installation.md', 'guides/installation', 'core', { title: 'Installation', sidebar: { group: 'Guides', order: 2 } }),
      guide('docs/src/queries.md', 'concepts/queries', 'core', { title: 'Captured queries', aliases: [] }),
      guide('docs/src/ownership.md', 'topics/ownership', 'core', { title: 'Ownership and I/O', aliases: [] }),
      guide('docs/src/observations.md', 'topics/observations', 'core', { title: 'Observing output', aliases: [] }),
      guide('docs/src/compatibility.md', 'guides/compatibility', 'core', { title: 'Compatibility' }),
      guide('docs/src/troubleshooting.md', 'guides/troubleshooting', 'core', { title: 'Troubleshooting' }),
      guide('docs/src/mcp.md', 'mcp/source-guide', 'mcp', {
        title: 'MCP server guide', product: 'mcp', package: 'mcp', aliases: [],
        equivalence: 'mcp-client-setup', sidebar: { group: 'Guides' },
      }),
      guide('docs/src/workspaces.md', 'workspace/source-guide', 'workspace', { title: 'Workspace guide', product: 'workspace', package: 'workspace', aliases: [] }),
    ],
    redirects: [{ sourcePath: 'docs/src/api.md', path: 'guides/api-overview', target: 'reference' }],
  },
  clojure: {
    domains: [
      libraryDomain('Captured persistent values, explicit effects and bounded JVM tasks over libtmux-java.'),
      { id: 'async', label: 'core.async adapter', kind: 'companion-package', navGroup: 'Library',
        route: 'guides/core-async', package: 'async',
        description: 'Use the optional, separately installable adapter for bounded event channels and explicit shutdown.' },
    ],
    sourceGuides: [
      guide('libtmux-clojure/README.md', 'guides/getting-started', 'core', {
        title: 'Getting started', sidebar: { group: 'Guides', order: 2 },
      }),
      guide('docs/guide/clojure.md', 'guides/captures-and-effects', 'core', {
        title: 'Captures, effects and streams', sidebar: { group: 'Guides', order: 3 },
      }),
      guide('docs/guide/clojure-reference.md', 'guides/captured-values', 'core', {
        title: 'Captured values', sidebar: { group: 'Guides', order: 4 },
      }),
      guide('libtmux-clojure-core-async/README.md', 'guides/core-async', 'async', {
        title: 'core.async adapter', sidebar: { group: 'Guides', order: 5 },
      }),
    ],
    redirects: [
      { sourcePath: 'docs/guide/clojure-api.md', path: 'guides/native-api', target: 'reference' },
      { sourcePath: 'docs/guide/clojure-core-async-api.md', path: 'guides/adapter-api', target: 'reference/libtmux-core-async' },
    ],
  },
  kotlin: {
    domains: [libraryDomain('Kotlin coroutine handles, builders and flows over the Java/JVM library.')],
    sourceGuides: [
      guide('libtmux-kotlin/README.md', 'guides/getting-started', 'core', {
        title: 'Getting started', sidebar: { group: 'Guides', order: 2 },
      }),
      guide('docs/guide/kotlin.md', 'guides/coroutines', 'core', {
        title: 'Coroutines and flows', aliases: ['guides/source/coroutines'], sidebar: { group: 'Guides', order: 4 },
      }),
    ],
  },
  scala: {
    domains: [libraryDomain('Scala 3 handles, immutable collections and effects over the Java/JVM library.')],
    sourceGuides: [
      guide('libtmux-scala/README.md', 'guides/overview', 'core', {
        title: 'Installation and requirements', sidebar: { group: 'Guides', order: 4 },
      }),
      ...['getting-started', 'query', 'ownership', 'execution', 'streaming', 'compatibility'].map((name, index) =>
        guide(`docs/guide/scala/${name}.md`, `guides/${name}`, 'core', {
          aliases: [`guides/source/${name}`],
          sidebar: { group: 'Guides', order: name === 'getting-started' ? 2 : index + 4 },
        })),
    ],
  },
  fsharp: {
    domains: [libraryDomain('F# sequences, task helpers and typed filters over the C#/.NET library.')],
    sourceGuides: [
      guide('src/LibTmux.FSharp/README.md', 'guides/quickstart', 'core', {
        title: 'Quick start', description: 'Install the package, capture server state, and choose a read operation.',
        sidebar: { group: 'Guides', order: 4 },
      }),
      ...[
        ['getting-started', 'Getting started', 'Create a project and connect to a tmux server.'],
        ['queries', 'Querying and filtering', 'List objects, handle missing matches, and filter captured relations.'],
        ['streams', 'Streams and cleanup', 'Consume events with bounded lifetimes and cancellation.'],
        ['interop', '.NET interoperation', 'Use core operations alongside the F# helpers.'],
        ['modes', 'Execution modes', 'Choose commands, control mode, or bounded concurrent reads.'],
        ['supported-query-fields', 'Query fields', 'Browse the fields supported by typed filters.'],
      ].map(([name, title, description], index) =>
        guide(`docs/fsharp/${name}.md`, `guides/${name}`, 'core', {
          title, description,
          aliases: [`guides/source/${name}`],
          sidebar: { group: 'Guides', order: name === 'getting-started' ? 2 : index + 4 },
        })),
    ],
    redirects: [{ sourcePath: 'docs/fsharp/api.md', path: 'guides/api-overview', target: 'reference' }],
  },
  ruby: {
    domains: [
      {
        id: 'core', label: 'Core library', kind: 'core', navGroup: 'Library', route: 'core', package: 'core',
        description: 'Install libtmux and work with tmux servers, sessions, windows, and panes.',
      },
      {
        id: 'async', label: 'Async', kind: 'companion-package', navGroup: 'Companion packages', route: 'guides/async', package: 'async',
        description: 'Use the libtmux-async companion package for asynchronous tmux work.',
      },
      {
        id: 'mcp', label: 'MCP', kind: 'product', navGroup: 'Apps', route: 'mcp', package: 'mcp', product: 'mcp',
        description: 'Configure libtmux-mcp and inspect its tmux tool protocol.',
      },
      {
        id: 'workspace', label: 'Workspace Manager', kind: 'product', navGroup: 'Apps', route: 'workspace', package: 'workspace', product: 'workspace',
        description: 'Validate, plan, and load workspace configuration with libtmux-workspace.',
      },
    ],
    sourceGuides: [
      guide('README.md', 'guides/getting-started', 'core', {
        title: 'Getting started', description: 'Install the gem, create a session, and query a snapshot.',
        aliases: ['guides/source/overview', 'guides/overview'], sidebar: { group: 'Guides', order: 2 },
      }),
      guide('docs/modes.md', 'concepts/transports', 'core', {
        title: 'Execution modes', description: 'Choose blocking commands, captured queries, control mode, or Async tasks.',
        aliases: ['guides/source/execution-modes', 'guides/execution-modes'], sidebar: { group: 'Concepts', order: 3 },
      }),
      guide('docs/ownership-errors.md', 'topics/errors-and-exceptions', 'core', {
        description: 'Understand server ownership, immutable references, and operation failures.',
        aliases: ['guides/source/ownership-errors', 'guides/ownership-errors', 'topics/context-managers'],
        sidebar: { group: 'Topics', order: 2 },
      }),
      guide('docs/recipes.md', 'examples/recipes', 'core', {
        title: 'Recipes', description: 'Run programs for queries, linked windows, capture, and cancellation.',
        aliases: ['examples/source-recipes'], sidebar: { group: 'Examples', order: 3 },
      }),
      guide('gems/libtmux/README.md', 'guides/core', 'core', {
        title: 'Server bindings', description: 'Own a private server or connect to an existing socket.',
        package: 'core', sidebar: { group: 'Guides', order: 4 },
      }),
      guide('gems/libtmux-async/README.md', 'guides/async', 'async', {
        title: 'Async', description: 'Run concurrent commands within an owned Async scope.',
        package: 'async', sidebar: { group: 'Companion packages' },
      }),
      guide('gems/libtmux-mcp/README.md', 'mcp/source-guide', 'mcp', {
        title: 'MCP server guide', sidebar: { group: 'Guides', order: 3 },
        package: 'mcp', product: 'mcp', aliases: [],
        equivalence: 'mcp-client-setup',
      }),
      guide('gems/libtmux-workspace/README.md', 'workspace/source-guide', 'workspace', {
        title: 'Workspace guide', sidebar: { group: 'Guides', order: 3 },
        package: 'workspace', product: 'workspace', aliases: [],
      }),
    ],
  },
  erlang: {
    apiDocRoot: 'docs',
    domains: [
      libraryDomain('Install the OTP application from Git and use native records, captured graphs and explicit tmux operations.'),
      { id: 'workspace', label: 'Workspace Manager', kind: 'unavailable', navGroup: 'Availability', route: 'workspace', product: 'workspace',
        description: 'The source application validates JSON desired state. Its plan/apply workflow and CLI are unfinished.' },
    ],
    sourceGuides: [
      guide('README.md', 'guides/getting-started', 'core', { title: 'Getting started', aliases: [], sidebar: { group: 'Guides', order: 1 } }),
      guide('docs/installation.md', 'guides/installation', 'core', { title: 'Installation', aliases: [], sidebar: { group: 'Guides', order: 2 } }),
      guide('docs/graph.md', 'concepts/object-graph', 'core', { title: 'Object graph', aliases: [] }),
      guide('docs/querying.md', 'concepts/queries', 'core', { title: 'Selections and queries', aliases: [] }),
      guide('docs/ownership.md', 'topics/ownership', 'core', { title: 'Ownership and identity', aliases: [] }),
      guide('docs/diagnostics.md', 'topics/diagnostics', 'core', { title: 'Diagnostics', aliases: [] }),
      guide('docs/adr-0001-architecture.md', 'concepts/architecture', 'core', { title: 'Architecture decisions', aliases: [] }),
      guide('docs/adr-0002-batched-hydration.md', 'concepts/capture-strategy', 'core', { title: 'Batched graph capture', aliases: [] }),
      guide('docs/jobs.md', 'guides/operations', 'core', { title: 'Owned operations', aliases: [] }),
      guide('docs/control.md', 'topics/control', 'core', { title: 'Control connections', aliases: [] }),
      ...['panes', 'buffers', 'options', 'hooks', 'keys', 'configuration', 'commands', 'compatibility'].map((name) =>
        guide(`docs/${name}.md`, `guides/${name}`, 'core', { aliases: [] })),
      guide('docs/pipe.md', 'guides/piping', 'core', { title: 'Pipe pane output', aliases: [] }),
      guide('docs/fields.md', 'reference/fields', 'core', { title: 'Fields and operators', aliases: [] }),
      guide('docs/options-reference.md', 'reference/options', 'core', { title: 'Options', aliases: [] }),
      guide('docs/commands-reference.md', 'reference/commands', 'core', { title: 'Command capabilities', aliases: [] }),
      guide('docs/api.md', 'guides/api-documentation', 'core', { title: 'Native API documentation', aliases: [] }),
      guide('docs/workspaces.md', 'guides/workspace-json', 'core', { title: 'Workspace JSON loader', aliases: [] }),
      guide('docs/project-policy.md', 'topics/project-policy', 'core', { title: 'Project policy', aliases: [] }),
    ],
    redirects: [{ sourcePath: 'docs/guides.md', path: 'guides/overview', target: 'guides' }],
  },
  elixir: {
    domains: [
      {
        id: 'core', label: 'Core library', kind: 'core', navGroup: 'Library', route: 'core', package: 'core',
        description: 'Install libtmux from Hex and observe tmux as immutable snapshots.',
      },
      {
        id: 'mcp', label: 'MCP', kind: 'unavailable', navGroup: 'Availability', route: 'mcp', product: 'mcp',
        description: 'No published MCP server is available for the Elixir port.',
      },
      {
        id: 'workspace', label: 'Workspace Manager', kind: 'unavailable', navGroup: 'Availability', route: 'workspace', product: 'workspace',
        description: 'No published workspace manager is available for the Elixir port.',
      },
    ],
    sourceGuides: [
      guide('README.md', 'guides/overview', 'core', {
        title: 'Getting started', description: 'Add the Hex package, check the Elixir, OTP and tmux requirements, and run an example.',
        aliases: [], sidebar: { group: 'Guides', order: 2 },
      }),
      guide('docs/filtering.md', 'guides/filtering', 'core', {
        description: 'Select observed values with portable keyword and operator filters.',
        aliases: [], sidebar: { group: 'Guides', order: 3 },
      }),
      guide('docs/first-task.md', 'examples/capture-and-read', 'core', {
        title: 'Capture a pane and read it', description: 'Capture a graph, select a pane and read it through one-shot and control commands.',
        aliases: [], sidebar: { group: 'Examples', order: 3 },
      }),
      guide('docs/mental-model.md', 'concepts/mental-model', 'core', {
        description: 'Hold one captured graph for several decisions and run a command when you need another.',
        aliases: [], sidebar: { group: 'Concepts', order: 2 },
      }),
      guide('docs/observations.md', 'concepts/observations', 'core', {
        description: 'Capture an immutable snapshot of an existing server and read it without further commands.',
        aliases: [], sidebar: { group: 'Concepts', order: 3 },
      }),
      guide('docs/ownership.md', 'topics/ownership', 'core', {
        description: 'Run an executable without a shell, with exit status kept apart from output.',
        aliases: [], sidebar: { group: 'Topics', order: 2 },
      }),
      guide('docs/encoding.md', 'topics/encoding', 'core', {
        description: 'Render commands and decode fields without a shell or a raw newline.',
        aliases: [], sidebar: { group: 'Topics', order: 3 },
      }),
      guide('docs/schema.md', 'topics/schema', 'core', {
        description: 'Fields, wire names, value categories and operators of each observed entity.',
        aliases: [], sidebar: { group: 'Topics', order: 4 },
      }),
    ],
  },
  lua: {
    domains: [
      {
        id: 'core', label: 'Core library', kind: 'core', navGroup: 'Library', route: 'core', package: 'core',
        description: 'Install libtmux and control tmux through the Lua core API.',
      },
      {
        id: 'runtime', label: 'luv and Neovim', kind: 'runtime', navGroup: 'Runtime adapters', route: 'guides/runtime',
        description: 'Use the documented libuv and Neovim runtime integrations.',
      },
      {
        id: 'mcp', label: 'MCP', kind: 'unavailable', navGroup: 'Availability', route: 'mcp', product: 'mcp',
        description: 'No published MCP server is available for the Lua port.',
      },
      {
        id: 'workspace', label: 'Workspace Manager', kind: 'unavailable', navGroup: 'Availability', route: 'workspace', product: 'workspace',
        description: 'No published workspace manager is available for the Lua port.',
      },
    ],
    sourceGuides: [
      guide('README.md', 'guides/overview', 'core', {
        title: 'Getting started', aliases: ['guides/source/overview', 'guides/getting-started'],
        sidebar: { group: 'Guides', order: 2 },
      }),
      guide('docs/runtime.md', 'guides/runtime', 'runtime', { sidebar: { group: 'Runtime adapters', label: 'luv and Neovim' } }),
      guide('docs/query.md', 'guides/query', 'core', { aliases: ['guides/source/query', 'concepts/queries', 'guides/querying-and-filtering'] }),
      guide('docs/snapshots.md', 'guides/snapshots', 'core'),
      guide('docs/creation.md', 'guides/creation', 'core'),
      guide('docs/topology.md', 'guides/topology', 'core'),
      guide('docs/panes.md', 'guides/panes', 'core', { aliases: ['guides/source/panes', 'topics/pane-interaction', 'guides/capturing-output', 'guides/sending-keys'] }),
      guide('docs/control.md', 'guides/control', 'core', { aliases: ['guides/source/control', 'concepts/transports'] }),
      guide('docs/commands.md', 'guides/commands', 'core'),
      guide('docs/buffers.md', 'guides/buffers', 'core'),
      guide('docs/clients.md', 'guides/clients', 'core'),
      guide('docs/environment.md', 'topics/environment', 'core', {
        aliases: ['guides/source/environment', 'guides/environment'], sidebar: { group: 'Topics', order: 3 },
      }),
      guide('docs/settings.md', 'topics/options-and-hooks', 'core', {
        aliases: ['guides/source/settings', 'guides/settings'], sidebar: { group: 'Topics', order: 2 },
      }),
      guide('docs/fields.md', 'topics/format-token-fields', 'core', {
        aliases: ['guides/source/fields', 'guides/fields'], sidebar: { group: 'Topics', order: 4 },
      }),
      guide('docs/options-reference.md', 'guides/options', 'core'),
      guide('docs/compatibility.md', 'guides/compatibility', 'core'),
    ],
  },
}

export const SOURCE_GUIDE_PORTS = Object.keys(PORT_DOCUMENTATION)

function documentationFor(portSlug: string): PortDocumentation | undefined {
  const port = PORT_BY_SLUG[portSlug]
  if (!port) throw new Error(`port-documentation: unknown port slug "${portSlug}"`)
  return PORT_DOCUMENTATION[portSlug]
}

function assertDistinct(label: string, values: readonly string[]): void {
  if (new Set(values).size !== values.length) throw new Error(`port-documentation: duplicate ${label}`)
}

/** Fail closed if port metadata and reader-facing configuration disagree. */
function validate(portSlug: string, config: PortDocumentation): void {
  const port = PORT_BY_SLUG[portSlug]
  for (const [section, description] of Object.entries(config.sections ?? {})) {
    if (!Object.hasOwn(SECTION_DESCRIPTIONS, section) || !description.trim()) throw new Error(`port-documentation: invalid section ${portSlug}/${section}`)
  }
  assertDistinct(`${portSlug} domain id`, config.domains.map((domain) => domain.id))
  assertDistinct(`${portSlug} domain route`, config.domains.map((domain) => domain.route))
  const domainById = new Map(config.domains.map((domain) => [domain.id, domain]))
  for (const domain of config.domains) {
    if (domain.route.startsWith('/') || domain.route.includes('..')) throw new Error(`port-documentation: invalid route ${domain.route}`)
    if (domain.kind === 'runtime' && (domain.package || domain.product)) throw new Error(`port-documentation: runtime ${domain.id} cannot be a package or product`)
    if (domain.kind === 'unavailable') {
      if (!domain.product || productAvailable(port, domain.product) || domain.package) throw new Error(`port-documentation: unavailable ${domain.id} must be an unavailable product without a package`)
      continue
    }
    if (domain.kind === 'product' && (!domain.product || !productAvailable(port, domain.product))) throw new Error(`port-documentation: product ${domain.id} must be available`)
    if (domain.kind === 'companion-package' && (!domain.package || domain.package === 'core' || !port.packages?.some((pkg) => pkg.id === domain.package))) throw new Error(`port-documentation: companion ${domain.id} needs a published package`)
  }
  const guidePaths = config.sourceGuides.flatMap((entry) => [entry.route, ...entry.aliases])
  assertDistinct(`${portSlug} source guide route or alias`, guidePaths)
  for (const entry of config.sourceGuides) {
    if (!domainById.has(entry.domain)) throw new Error(`port-documentation: ${entry.sourcePath} names unknown domain ${entry.domain}`)
    if (entry.route.startsWith('/') || entry.route.includes('..')) throw new Error(`port-documentation: invalid source guide route ${entry.route}`)
  }
}

function fallbackAreas(portSlug: string): readonly DocumentationDomain[] {
  const port = PORT_BY_SLUG[portSlug]
  return [
    {
      id: 'core', label: 'Core library', kind: 'core', navGroup: 'Library', route: 'core', package: 'core',
      description: `Install ${port.packageName} and use the ${port.name} tmux API.`,
    },
    ...Object.entries(DOC_PRODUCTS).filter(([id]) => productIncluded(port, id as DocProduct)).map(([id, product]) => {
      const available = productAvailable(port, id as DocProduct)
      return {
        id,
        label: product.label,
        description: productDescription(port, id as DocProduct),
        kind: available ? 'product' as const : 'unavailable' as const,
        navGroup: available ? 'Apps' : 'Availability',
        route: id,
        product: id as DocProduct,
      }
    }),
  ]
}

export function documentationAreas(portSlug: string): readonly DocumentationDomain[] {
  const config = documentationFor(portSlug)
  if (!config) return fallbackAreas(portSlug)
  validate(portSlug, config)
  return config.domains
}

export function sourceGuidesFor(portSlug: string): readonly PortSourceGuide[] {
  const config = documentationFor(portSlug)
  if (!config) throw new Error(`port-documentation: no source guide configuration for ${portSlug}`)
  validate(portSlug, config)
  return config.sourceGuides
}

/** Section indexes offered by the landing page and documentation menu. */
export function documentationSectionsFor(portSlug: string): readonly string[] {
  const config = documentationFor(portSlug)
  if (config) validate(portSlug, config)
  if (config?.sections) return Object.keys(config.sections)
  return PORT_BY_SLUG[portSlug]!.parentLibrary ? ['guides', 'examples', 'concepts'] : ['topics', 'guides', 'examples', 'concepts']
}

/** Native API guide destinations under the displayed port/version root. */
export function apiDocLinksFor(portSlug: string, baseHref: string): ReadonlyMap<string, string> {
  const config = documentationFor(portSlug)
  if (!config?.apiDocRoot) return new Map()
  validate(portSlug, config)
  const prefix = `${config.apiDocRoot}/`
  return new Map(config.sourceGuides.filter((entry) => entry.sourcePath.startsWith(prefix))
    .map((entry) => [entry.sourcePath.slice(prefix.length), `${baseHref}${entry.route}/`]))
}

/**
 * The section overviews staging writes for a port's source guides, unless the
 * port authors one itself: guides for every staged port, and examples, topics
 * and concepts too unless the catalog selects its populated sections or the
 * port wraps another library's source.
 * `scripts/stage-port-docs.mjs` writes them; the Core page cards are tested
 * against this list.
 */
export function stagedSectionsFor(portSlug: string): readonly string[] {
  const documentation = documentationFor(portSlug)
  if (!documentation) return []
  validate(portSlug, documentation)
  if (documentation.stagedSections) return documentation.stagedSections
  if (documentation.sections) return Object.keys(documentation.sections)
  return PORT_BY_SLUG[portSlug]!.parentLibrary ? ['guides'] : ['guides', 'examples', 'topics', 'concepts']
}

/** Reader-facing introduction for a section that staging actually writes. */
export function stagedSectionDescription(portSlug: string, section: string): string {
  if (!stagedSectionsFor(portSlug).includes(section)) throw new Error(`port-documentation: no staged section ${portSlug}/${section}`)
  const description = documentationFor(portSlug)?.sections?.[section] ?? SECTION_DESCRIPTIONS[section]
  if (!description?.trim()) throw new Error(`port-documentation: no description for ${portSlug}/${section}`)
  return description
}

/** Retired source pages point to the reference that now owns their content. */
export function sourceGuideRedirectsFor(portSlug: string) {
  return documentationFor(portSlug)?.redirects ?? []
}

export function sourceGuideFor(portSlug: string, sourcePath: string): PortSourceGuide {
  const guide = sourceGuidesFor(portSlug).find((entry) => entry.sourcePath === sourcePath)
  if (!guide) throw new Error(`port-documentation: no source guide for ${portSlug}:${sourcePath}`)
  return guide
}

export interface DocumentationNavigationGroup {
  label: string
  items: { type: 'link'; label: string; href: string }[]
}

export interface DocumentationCard {
  label: string
  body: string
  href: string
  kind: DocumentationDomainKind
}

/** Generic renderer input; only data, never Ruby/Lua route conditionals. */
export function documentationNavigation(portSlug: string, version: string): DocumentationNavigationGroup[] {
  const port = PORT_BY_SLUG[portSlug]
  if (!port) throw new Error(`port-documentation: unknown port ${portSlug}`)
  const groups = new Map<string, DocumentationNavigationGroup>()
  for (const domain of documentationAreas(portSlug)) {
    if (domain.kind === 'unavailable') continue
    const group = groups.get(domain.navGroup) ?? { label: domain.navGroup, items: [] }
    group.items.push({
      type: 'link',
      label: domain.label,
      href: portPageUrl(port, version, domain.route),
    })
    groups.set(domain.navGroup, group)
  }
  return [...groups.values()]
}

/** Landing cards omit the current core page and describe the remaining domains. */
export function documentationCards(portSlug: string, version: string): DocumentationCard[] {
  const port = PORT_BY_SLUG[portSlug]
  if (!port) throw new Error(`port-documentation: unknown port ${portSlug}`)
  return documentationAreas(portSlug)
    .filter((domain) => domain.kind !== 'core' && domain.kind !== 'unavailable')
    .map((domain) => ({
      label: domain.label,
      body: domain.description,
      href: portPageUrl(port, version, domain.route),
      kind: domain.kind,
    }))
}
