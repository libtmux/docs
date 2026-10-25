import type { APIRoute, GetStaticPaths } from 'astro'
import { sidebarDemoData, sidebarPreviewPaths } from '../../../../lib/sidebar-demo-data'

export const getStaticPaths: GetStaticPaths = sidebarPreviewPaths
export const GET: APIRoute = ({ params }) => new Response(JSON.stringify(sidebarDemoData(params.port!).inventory), {
  headers: { 'Content-Type': 'application/json' },
})
