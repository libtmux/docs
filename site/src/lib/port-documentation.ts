/** Reader-facing port domains and source-guide routes, separate from API products. */
import {
  DOC_PRODUCTS,
  PORT_BY_SLUG,
  portPageUrl,
  productAvailable,
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
  /** Canonical path below a port/version root; empty is the library landing. */
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
  domain: string
  package?: PortPackageId
  product?: DocProduct
  sidebar?: { group: string; label?: string; order?: number }
}

interface PortDocumentation {
  domains: readonly DocumentationDomain[]
  sourceGuides: readonly PortSourceGuide[]
  redirects?: readonly { sourcePath: string; path: string; target: string }[]
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
  id: 'core', label: 'Library', kind: 'core', navGroup: 'Library', route: '', package: 'core', description,
})

const PORT_DOCUMENTATION: Readonly<Record<string, PortDocumentation>> = {
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
        id: 'core', label: 'Core library', kind: 'core', navGroup: 'Library', route: '', package: 'core',
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
      guide('gems/libtmux-mcp/README.md', 'mcp/source-guide', 'mcp', { package: 'mcp', product: 'mcp', aliases: [] }),
      guide('gems/libtmux-workspace/README.md', 'workspace/source-guide', 'workspace', { package: 'workspace', product: 'workspace', aliases: [] }),
    ],
  },
  lua: {
    domains: [
      {
        id: 'core', label: 'Core library', kind: 'core', navGroup: 'Library', route: '', package: 'core',
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
      id: 'core', label: 'Core library', kind: 'core', navGroup: 'Library', route: '', package: 'core',
      description: `Install ${port.packageName} and use the ${port.name} tmux API.`,
    },
    ...Object.entries(port.parentLibrary ? {} : DOC_PRODUCTS).map(([id, product]) => {
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
    const group = groups.get(domain.navGroup) ?? { label: domain.navGroup, items: [] }
    group.items.push({
      type: 'link',
      label: domain.kind === 'unavailable' ? `${domain.label} (not available)` : domain.label,
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
    .filter((domain) => domain.kind !== 'core')
    .map((domain) => ({
      label: domain.kind === 'unavailable' ? `${domain.label} (not available)` : domain.label,
      body: domain.description,
      href: portPageUrl(port, version, domain.route),
      kind: domain.kind,
    }))
}
