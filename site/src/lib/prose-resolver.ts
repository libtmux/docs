import { Resolver, decideFilePath, decideMention, notASymbol, parentInventory, type ApiProduct, type InventoryEntry, type MentionContext, type MentionDecision } from '@libtmux/api-model'
import { API_MODELS, PORT_NAME, referenceHref } from './api-models'
import { productApiHref } from './product-api'
import { PORTS, PORT_BY_SLUG, portPageUrl, referenceUrl } from './ports'
import { decideMcpMention, mcpRunMentions } from './mcp-catalog'
import type { Mention } from './tmux-links'
import { linkedVersionFor } from './versions'
import { withPortRoot } from './site-root'
import domInv from '../data/inventories/dom.entries.json'
import jdkInv from '../data/inventories/jdk.entries.json'
import pythonInv from '../data/inventories/python.entries.json'
import juliaInv from '../data/inventories/julia.entries.json'
import pyPaths from '../data/api/py.paths.json'
import rubyPaths from '../data/api/ruby.paths.json'
import luaPaths from '../data/api/lua.paths.json'
import tsPaths from '../data/api/ts.paths.json'
import rsPaths from '../data/api/rs.paths.json'
import goPaths from '../data/api/go.paths.json'
import javaPaths from '../data/api/java.paths.json'
import csharpPaths from '../data/api/csharp.paths.json'
import cxxPaths from '../data/api/cxx.paths.json'
import swiftPaths from '../data/api/swift.paths.json'
import kotlinPaths from '../data/api/kotlin.paths.json'
import scalaPaths from '../data/api/scala.paths.json'
import fsharpPaths from '../data/api/fsharp.paths.json'
import powershellPaths from '../data/api/powershell.paths.json'
import juliaPaths from '../data/api/julia.paths.json'
import elixirPaths from '../data/api/elixir.paths.json'

/** Language labels used by shared prose headings and comparison rows. */
export const PORT_BY_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(PORT_NAME).map(([slug, name]) => [name, slug]),
)

// Static imports also survive the bundled Markdown route, where source files
// are no longer adjacent to this module.
const PATHS: Record<string, { repo: string; revision: string; paths: string[] }> = {
  py: pyPaths, ruby: rubyPaths, lua: luaPaths, ts: tsPaths, rs: rsPaths,
  go: goPaths, java: javaPaths, csharp: csharpPaths, cxx: cxxPaths,
  swift: swiftPaths, kotlin: kotlinPaths, scala: scalaPaths, fsharp: fsharpPaths,
  powershell: powershellPaths, julia: juliaPaths, elixir: elixirPaths,
}
const TREES = Object.fromEntries(Object.entries(PATHS).map(([port, data]) => [port, new Set(data.paths)]))
const FILE_RE = /^[\w./@-]+\.(py|ts|tsx|js|rs|go|java|cs|cpp|hpp|h|swift|jl|ex|exs|ps1|psm1|psd1|md|toml|json|ya?ml|sh)$/

type ProseDecision = MentionDecision & { file?: boolean }

/** Resolve HTML and Markdown prose against the same version and source tree. */
export function createProseLinker(product?: ApiProduct) {
  const resolver = getResolver()
  const versionOf = (port: string) => linkedVersionFor(port)

  return (text: string, context: Pick<MentionContext, 'pagePort' | 'before'>): ProseDecision => {
    let protocol = decideMcpMention(text, { ...context, product })
    // Markdown encodes URI-template braces; literal registrations still win.
    if (protocol?.kind === 'unresolved' && text.startsWith('mcp:')) {
      try { protocol = decideMcpMention(decodeURIComponent(text), { ...context, product }) ?? protocol } catch { /* Preserve malformed destinations. */ }
    }
    if (protocol?.kind === 'link') {
      const { port, object } = protocol
      return { kind: 'link', port, external: false,
        href: portPageUrl(PORT_BY_SLUG[port]!, versionOf(port), object.path),
        title: `${object.name}: ${PORT_NAME[port]} MCP ${object.kind}` }
    }
    if (protocol) return protocol
    if (FILE_RE.test(text) || text.endsWith('/')) {
      const decision = decideFilePath(text, context, TREES)
      if (decision.kind === 'unresolved') return { ...decision, tried: [], file: true }
      if (decision.kind !== 'link') return decision
      const meta = PATHS[decision.port]!
      return {
        kind: 'link', port: decision.port, file: true, external: true,
        href: `https://github.com/${meta.repo}/${decision.dir ? 'tree' : 'blob'}/${meta.revision}/${decision.path}`,
        title: `${decision.path}: ${meta.repo}`,
      }
    }
    if (notASymbol(text)) return { kind: 'skip', why: 'not a symbol' }
    const decision = decideMention(text, {
      ...context, product,
      symbolHref: (port, symbol) => productApiHref(API_MODELS[port], symbol, versionOf(port)),
      moduleHref: (port, module) => {
        const target = PORT_BY_SLUG[port]
        return target ? `${referenceUrl(target, versionOf(port))}#${module}` : `#${module}`
      },
    }, resolver, API_MODELS)
    if (decision.kind === 'link' && decision.href.startsWith('/reference/')) {
      return { ...decision, href: withPortRoot(decision.href) }
    }
    return decision
  }
}

/** MCP tools and prompts named inside a longer code run, linked as an explicit `mcp:` reference is. */
export function protocolRunMentions(link: ReturnType<typeof createProseLinker>, text: string, port: string): Mention[] {
  return mcpRunMentions(text, port).flatMap(({ start, end, object }) => {
    const decision = link(`mcp:${object.kind}:${object.name}`, { pagePort: port })
    return decision.kind === 'link' ? [{
      start, end, text: text.slice(start, end), kind: object.kind, name: object.name, href: decision.href,
      family: 'mcp' as const, inline: true,
    }] : []
  })
}

/**
 * The resolver that answers "what does this name refer to", with the
 * standard-library inventories attached.
 *
 * One instance, shared. It lived inside `plugins/rehype-api-links.ts`, which
 * only runs over Markdown — so prose written in an `.astro` template could not
 * reach it, and `java.nio.file.Path` in the Java quickstart note rendered as
 * plain text while the same name in a Markdown page linked to Oracle's
 * javadoc. Two behaviours from one rule means the rule is in the wrong place.
 *
 * The inventories are imported, not read from disk. The plugin found them with
 * `import.meta.url` and `fs`, which is correct where a Vite plugin runs and
 * silently wrong inside a bundled SSR component: `existsSync` returned false,
 * no inventory was added, and every standard-library name resolved to nothing
 * with no error anywhere. An import is resolved by the bundler and fails
 * loudly.
 *
 * Scoped to the ports they describe. An unscoped CPython inventory once
 * answered for all eight and sent Go readers to Python's `time` module.
 */
/** The sidecar shape as the JSON import types it: rows of [name, uri]. */
interface InventorySidecar {
  e: (string | undefined)[][]
}

const INVENTORIES: {
  data: InventorySidecar
  project: string
  baseUrl: string
  langs: string[]
}[] = [
  { data: pythonInv, project: 'Python', baseUrl: 'https://docs.python.org/3/', langs: ['py'] },
  {
    data: jdkInv,
    project: 'Java SE',
    baseUrl: 'https://docs.oracle.com/en/java/javase/21/docs/api/',
    langs: ['java', 'kotlin', 'scala'],
  },
  { data: domInv, project: 'MDN', baseUrl: 'https://developer.mozilla.org/', langs: ['ts'] },
  { data: juliaInv, project: 'Julia', baseUrl: 'https://docs.julialang.org/en/v1/', langs: ['julia'] },
]

/**
 * The sidecar back into entries.
 *
 * `type` and `dispname` are reconstructed rather than stored: a lookup uses
 * neither, and only the writer cares what domain a name belongs to.
 */
const entriesOf = (inv: InventorySidecar): InventoryEntry[] =>
  inv.e.map(([name, uri]) => ({
    name: name ?? '',
    type: 'std:label',
    priority: 1,
    uri: uri ?? '',
    dispname: '-',
  }))

let resolver: Resolver | undefined

/**
 * Languages whose standard library publishes an inventory get one; the other
 * five resolve through the curated map in `packages/api-model/src/builtins.ts`.
 * Both paths end at `Resolver`, so a caller never has to know which a language
 * has.
 */
export function getResolver(): Resolver {
  if (resolver) return resolver
  const r = new Resolver(Object.values(API_MODELS))
  for (const { data, project, baseUrl, langs } of INVENTORIES) {
    r.addInventory(project, baseUrl, entriesOf(data), langs)
  }
  for (const port of PORTS) {
    const dependencies = [...(port.parentLibrary ? [port.parentLibrary.slug] : []), ...(port.apiDependencies ?? [])]
    for (const dependency of dependencies) {
      r.addInventory(`libtmux ${PORT_NAME[dependency]}`, '', parentInventory(API_MODELS[dependency],
        (symbol) => referenceHref(dependency, symbol.publicId ?? symbol.id)!), [port.slug])
    }
  }
  resolver = r
  return r
}
