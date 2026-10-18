import type { APIRoute } from 'astro'
import { buildsTmuxDocumentation, TMUX_VERSIONS } from '../../../../lib/tmux-manual-data'
import { tmuxCatalogNavigation } from '../../../../lib/tmux-catalog'

export function getStaticPaths() {
  return buildsTmuxDocumentation() ? TMUX_VERSIONS.map((version) => ({ params: { version } })) : []
}
export const GET: APIRoute = ({ params }) => new Response(JSON.stringify(tmuxCatalogNavigation(params.version!).json), {
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
})
