import type { APIRoute, GetStaticPaths } from 'astro'
import { buildsTmuxDocumentation, TMUX_VERSIONS } from '../../../../lib/tmux-manual-data'
import { tmuxManualNavigation } from '../../../../lib/tmux-manual-navigation'

export const getStaticPaths: GetStaticPaths = () => buildsTmuxDocumentation() ? TMUX_VERSIONS.map((version) => ({ params: { version } })) : []
export const GET: APIRoute = ({ params }) => new Response(JSON.stringify(tmuxManualNavigation(params.version!).json), {
  headers: { 'Content-Type': 'application/json' },
})
