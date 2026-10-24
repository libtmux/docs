import type { APIRoute, GetStaticPaths } from 'astro'
import { DEMO_LANGUAGES, sidebarDemoData } from '../../../../lib/sidebar-demo-data'

export const getStaticPaths: GetStaticPaths = () => DEMO_LANGUAGES.map((port) => ({ params: { port } }))
export const GET: APIRoute = ({ params }) => new Response(JSON.stringify(sidebarDemoData(params.port!).inventory), {
  headers: { 'Content-Type': 'application/json' },
})
