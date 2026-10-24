import { API_GLOSSARY_PATH } from '../src/lib/api-glossary'
import { API_MODELS } from '../src/lib/api-models'
import { glossaryPreview, highlightedPreview, pagePreview, symbolPreview, tmuxManualPreview, type LinkPreview } from '../src/lib/link-preview'
import { mcpObjects } from '../src/lib/mcp-catalog'
import { mcpObjectPreview } from '../src/lib/mcp-preview'
import { tmuxCatalogEntries } from '../src/lib/tmux-catalog'
import { tmuxCatalogPreview } from '../src/lib/tmux-catalog-preview'
import { tmuxReferencePreview, tmuxReferenceRoutes } from '../src/lib/tmux-reference'

/** Real payloads of every kind the site writes: the producers, not fixtures, so that a change to one is seen here. */
export async function cardPayloads(): Promise<[string, LinkPreview][]> {
  const rs = API_MODELS.rs
  const referenced = (model: typeof rs, kind?: string) => model.symbols.find((symbol) => (!kind || symbol.kind === kind) && symbolPreview(model, symbol, 'latest').descriptionParts)!
  // A header is the owner and the member, so a name is long only where the member carries its labels, as Swift's do.
  const long = API_MODELS.swift.symbols.find((symbol) => symbol.parent && symbol.name.length > 60)!
  const glossary = glossaryPreview(API_GLOSSARY_PATH)
  const manual = tmuxManualPreview('latest', 'full')
  const object = (kind: string) => {
    for (const port of ['py', 'ts', 'rs', 'go', 'ruby', 'java']) {
      const found = mcpObjects(port).find((entry) => entry.kind === kind)
      if (found) return mcpObjectPreview(port, 'latest', found)
    }
    throw new Error(`No MCP ${kind}`)
  }
  const tool = mcpObjects('ruby').find((entry) => mcpObjectPreview('ruby', 'latest', entry).descriptionParts)!
  // The longest declaration of tmux's source: the preview cuts it to its head, and the card shows what it was given.
  const cRoute = tmuxReferenceRoutes().filter((route) => route.version === 'latest' && route.symbol)
    .reduce((longest, route) => (route.symbol!.signatures[0]?.raw?.length ?? 0) > (longest.symbol!.signatures[0]?.raw?.length ?? 0) ? route : longest)
  const cDeclaration = tmuxReferencePreview(cRoute.version, cRoute.symbol!)
  return Promise.all(([
    ['API method with a named type', symbolPreview(rs, referenced(rs, 'method'), 'latest')],
    ['API declaration without references', symbolPreview(API_MODELS.cxx, API_MODELS.cxx.symbols.find((symbol) => symbol.kind === 'class')!, 'latest')],
    ['API name long enough to abbreviate', symbolPreview(API_MODELS.swift, long, 'latest')],
    ['glossary page', glossary],
    ['glossary term that is a kind', glossary.terms!.struct],
    ['glossary term that is not a kind', glossary.terms!.inherited],
    ['MCP object naming another', mcpObjectPreview('ruby', 'latest', tool)],
    ['MCP prompt', object('prompt')],
    ['MCP resource template', object('resource-template')],
    ['tmux manual', manual],
    ['tmux command', tmuxManualPreview('latest', 'new-session')],
    ['tmux manual option', Object.values(manual.terms!).find((term) => term.kind === 'option')!],
    ['tmux catalog hook', tmuxCatalogPreview('latest', tmuxCatalogEntries('latest', 'hook')[0])],
    ['page with no kind', pagePreview({ title: 'Exit codes', description: 'What each command returns.' }, '/en/rs/latest/workspace/reference/exit-codes/')],
    ['tmux C declaration cut to its head', cDeclaration],
    ['an older payload with only the original fields', { schema: 1, title: 'Older', description: 'Written before footers and references.', href: '/en/rs/latest/reference/older/' }],
  ] satisfies [string, LinkPreview][]).map(async ([name, preview]) => [name, await highlightedPreview(preview)] as [string, LinkPreview]))
}
