import type { APIRoute } from 'astro'
import { buildsTmuxDocumentation, TMUX_VERSIONS } from '../../../../lib/tmux-manual-data'
import { tmuxReferenceTree } from '../../../../lib/tmux-reference'

export function getStaticPaths() {
  return buildsTmuxDocumentation() ? TMUX_VERSIONS.map((version) => ({ params: { version } })) : []
}
export const GET: APIRoute = ({ params }) => new Response(JSON.stringify(tmuxReferenceTree(params.version)), {
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
})
