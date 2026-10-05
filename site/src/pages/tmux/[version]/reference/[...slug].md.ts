import type { APIRoute } from 'astro'
import { sourceUrl } from '@libtmux/api-model'
import { symbolMarkdown } from '../../../../lib/symbol-markdown'
import { tmuxReferenceIndex, tmuxReferencePaths, tmuxReferenceRoutes, tmuxReferenceUrl, tmuxSourceCommands, tmuxSourceModel } from '../../../../lib/tmux-reference'

export function getStaticPaths() {
  return tmuxReferenceRoutes().filter(({ symbol }) => symbol).map(({ version, symbol }) => ({
    params: { version, slug: symbol!.slug }, props: { version, symbol: symbol! },
  }))
}
export const GET: APIRoute = ({ props, site }) => {
  const { version, symbol } = props
  const model = tmuxSourceModel(version)
  return new Response(symbolMarkdown({
    model, symbol, version, index: tmuxReferenceIndex(version),
    canonical: new URL(tmuxReferenceUrl(version, symbol), site).href,
    source: sourceUrl(model, symbol),
    hrefFor: (entry) => tmuxReferenceUrl(version, entry),
    manualLinks: tmuxSourceCommands(version, symbol),
    paths: tmuxReferencePaths(version),
  }), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
}
