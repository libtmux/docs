/**
 * What a port's landing page offers: the products the port ships and, for
 * each, a tested example.
 *
 * Core API shows the homepage's complete program (`quickstarts.ts`). MCP and
 * Workspace Manager show an excerpt of a program the port's own CI runs. The
 * excerpt is named in `site/src/data/landing-examples.json` and read from the
 * revision-bound example cache, the way a `file=` fence with `from` and `to`
 * anchors is, so the page cannot drift from the code CI runs.
 */

// build-site.sh and the example scripts import this module with bare Node;
// local imports need `.ts`.
import { DOC_PRODUCTS, hasPackageInstalls, portPageUrl, productAvailable, type DocProduct, type Port } from './ports.ts'
import { sliceExcerpt } from './example-excerpt.ts'

export type LandingProduct = 'core' | DocProduct

/** The selector's order, which is also the order of a port's panels. */
export const LANDING_PRODUCTS: readonly LandingProduct[] = ['core', 'mcp', 'workspace']

/** The selector's option labels. */
export const LANDING_LABEL: Readonly<Record<LandingProduct, string>> = {
  core: 'Core API',
  mcp: DOC_PRODUCTS.mcp.label,
  workspace: DOC_PRODUCTS.workspace.label,
}

/**
 * A port whose MCP server is another port's package. PowerShell has no server
 * of its own: its guide drives the .NET tool, so the panel installs and quotes
 * that tool.
 */
export const MCP_SERVED_BY: Readonly<Record<string, string>> = { powershell: 'csharp' }

/** The workflow command that runs the program. */
export interface LandingCi {
  /** Workflow file in the repository, such as `.github/workflows/tests.yml`. */
  workflow: string
  /** Text of the workflow's command that reaches the program, read with wrapped lines joined. */
  command: string
}

/** Lines of a file: `from` names the first, and the first match of `to` after it ends the range. */
export interface LandingRange {
  /** Text on the first line; exactly one line may contain it. */
  from: string
  /** Text on the last line; the first match after `from` ends the range. */
  to?: string
}

/** Ranges of a program the port's CI runs. */
export interface LandingExcerpt extends LandingRange {
  /** Path in the product's repository at the revision its API model cites. */
  file: string
  /** Fence language of the shown ranges. */
  lang: string
  /** Later ranges of the same file, in file order. The page separates each from the last with a blank line. */
  more?: readonly LandingRange[]
  ci: LandingCi
}

/** A product the port ships that has no program its CI runs yet. */
export interface LandingGap {
  missing: string
}

export type LandingEntry = LandingExcerpt | LandingGap
export type LandingTable = Readonly<Record<string, Partial<Record<DocProduct, LandingEntry>>>>

export const isGap = (entry: LandingEntry): entry is LandingGap => 'missing' in entry

/** The ranges an excerpt shows, in order. */
export const landingRanges = (entry: LandingExcerpt): LandingRange[] =>
  [{ from: entry.from, to: entry.to }, ...(entry.more ?? [])]

/**
 * Whether a workflow's `run` steps hold `command`, with lines wrapped by a shell
 * continuation or a folded scalar read as one. A comment, a step name or an
 * environment value that spells the command does not count.
 */
export function workflowRuns(workflow: string, command: string): boolean {
  const lines = workflow.split('\n')
  const steps: string[] = []
  lines.forEach((line, index) => {
    const key = /^(\s*(?:-\s+)?)run:[ \t]*(.*)$/.exec(line)
    if (!key) return
    const column = key[1]!.length
    const text = /^[|>][+-]?\d*$/.test(key[2]!.trim()) ? [] : [key[2]!]
    for (const next of lines.slice(index + 1)) {
      // Whatever is no deeper than the `run` key belongs to the next key or step.
      if (next.trim() && /^\s*/.exec(next)![0].length <= column) break
      text.push(next)
    }
    steps.push(text.filter((part) => !part.trim().startsWith('#')).join('\n'))
  })
  const flat = (text: string) => text.replace(/\\\n/g, ' ').replace(/\s+/g, ' ')
  return flat(steps.join('\n')).includes(flat(command))
}

/** Where the cache holds a product's file; a product may live outside the library's repository. */
export const landingCacheKey = (owner: string, product: DocProduct, file: string) => `${owner}/${product}:${file}`

/** The port whose source and example serve a product. */
export function landingOwner(port: Port, product: DocProduct): string {
  return product === 'mcp' ? MCP_SERVED_BY[port.slug] ?? port.slug : port.slug
}

/** The products a port ships, in selector order. Core API is always first. */
export function landingProducts(port: Port): LandingProduct[] {
  return LANDING_PRODUCTS.filter((product) => product === 'core'
    || (product === 'mcp' && (productAvailable(port, 'mcp') || port.slug in MCP_SERVED_BY))
    || (product === 'workspace' && productAvailable(port, 'workspace')))
}

/** One cached file, as `example-sources.json` holds it. */
export interface CachedSource {
  repository: string
  revision: string
  content: string
}

/** A shown excerpt and where it comes from. */
export interface ResolvedExcerpt {
  code: string
  lang: string
  file: string
  repository: string
  revision: string
  /** The file at the revision the cache holds. */
  sourceUrl: string
  ci: LandingCi
}

/**
 * The excerpt a product shows, or undefined when the port has none for it.
 * An anchor that matches no line, or several, throws and names the file.
 */
export function landingExcerpt(
  port: Port,
  product: DocProduct,
  table: LandingTable,
  cache: Readonly<Record<string, CachedSource | undefined>>,
): ResolvedExcerpt | undefined {
  const owner = landingOwner(port, product)
  const entry = table[owner]?.[product]
  if (!entry || isGap(entry)) return undefined
  const key = landingCacheKey(owner, product, entry.file)
  const cached = cache[key]
  if (!cached) throw new Error(`port-landing: ${key} is not in the example cache; run node scripts/gen-example-sources.mjs`)
  return {
    code: landingRanges(entry).map((range) => sliceExcerpt(cached.content, range, key)).join('\n\n'),
    lang: entry.lang,
    file: entry.file,
    repository: cached.repository,
    revision: cached.revision,
    sourceUrl: `https://github.com/${cached.repository}/blob/${cached.revision}/${entry.file}`,
    ci: entry.ci,
  }
}

/** One option of the selector and what its panel holds. */
export interface LandingPanel {
  product: LandingProduct
  label: string
  /** The product's documentation, absent for Core API, which the page itself introduces. */
  href?: string
  /** Absent when the port has no program its CI runs for the product. */
  excerpt?: ResolvedExcerpt
  /** The package the install widget adds. */
  packageName?: string
  /** The port whose package serves the product when this port has none of its own. */
  servedBy?: string
  /** Which install widget the panel keeps, and the port whose package it installs. */
  install?: { widget: 'package' | 'mcp'; port: string }
}

/** The panels of a port's landing page. */
export function landingPanels(
  port: Port,
  version: string,
  ports: Readonly<Record<string, Port>>,
  table: LandingTable,
  cache: Readonly<Record<string, CachedSource | undefined>>,
): LandingPanel[] {
  return landingProducts(port).map((product): LandingPanel => {
    if (product === 'core') return { product, label: LANDING_LABEL.core, packageName: port.packageName, install: { widget: 'package', port: port.slug } }
    const owner = ports[landingOwner(port, product)]!
    const packageName = owner.packages?.find((entry) => entry.id === product)?.name
    const installed = product === 'mcp'
      ? { widget: 'mcp' as const, port: owner.slug }
      : hasPackageInstalls(port, 'workspace') ? { widget: 'package' as const, port: port.slug } : undefined
    return {
      product,
      label: LANDING_LABEL[product],
      // PowerShell documents its MCP use as a guide in the library, not a product tree.
      href: portPageUrl(port, version, port.slug in MCP_SERVED_BY && product === 'mcp' ? 'guides/mcp' : product),
      excerpt: landingExcerpt(port, product, table, cache),
      packageName,
      servedBy: owner.slug === port.slug ? undefined : owner.name,
      install: installed,
    }
  })
}
