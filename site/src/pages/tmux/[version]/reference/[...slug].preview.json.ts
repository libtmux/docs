import type { APIRoute } from 'astro'
import { highlightedPreview } from '../../../../lib/link-preview'
import { tmuxReferencePreview, tmuxReferenceRoutes } from '../../../../lib/tmux-reference'

/** A preview for every declaration page, at the address the link-preview policy asks for: the page's path with `.preview.json`. */
export function getStaticPaths() {
  return tmuxReferenceRoutes().filter(({ symbol }) => symbol).map(({ version, symbol }) => ({
    params: { version, slug: symbol!.slug }, props: { version, symbol: symbol! },
  }))
}
export const GET: APIRoute = async ({ props }) => new Response(JSON.stringify(await highlightedPreview(tmuxReferencePreview(props.version, props.symbol))), {
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
})
