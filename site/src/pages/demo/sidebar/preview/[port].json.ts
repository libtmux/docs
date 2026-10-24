import type { APIRoute, GetStaticPaths } from 'astro'
import { referenceTree } from '../../../../lib/api-tree'
import { DEMO_LANGUAGES } from '../../../../lib/sidebar-demo'

export const getStaticPaths: GetStaticPaths = () => DEMO_LANGUAGES.map((port) => ({ params: { port } }))
export const GET: APIRoute = ({ params }) => new Response(JSON.stringify(referenceTree(params.port!)), {
  headers: { 'Content-Type': 'application/json' },
})
