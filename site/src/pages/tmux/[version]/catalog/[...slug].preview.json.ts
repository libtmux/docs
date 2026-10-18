import type { APIRoute } from 'astro'
import { catalogKindForSegment, tmuxCatalogEntry, tmuxCatalogRoutes } from '../../../../lib/tmux-catalog'
import { highlightedPreview } from '../../../../lib/link-preview'
import { tmuxCatalogPreview } from '../../../../lib/tmux-catalog-preview'

export function getStaticPaths() {
  return tmuxCatalogRoutes().filter(({ slug }) => slug?.includes('/')).map(({ version, slug }) => ({ params: { version, slug } }))
}
export const GET: APIRoute = async ({ params }) => {
  const [segment, name] = params.slug!.split('/')
  const entry = tmuxCatalogEntry(params.version!, catalogKindForSegment(segment)!, name)!
  return new Response(JSON.stringify(await highlightedPreview(tmuxCatalogPreview(params.version!, entry))), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}
