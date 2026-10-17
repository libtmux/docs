import type { APIRoute } from 'astro'
import { apiGlossaryMarkdown } from '../../lib/api-glossary'

export const GET: APIRoute = ({ site, url }) => new Response(apiGlossaryMarkdown(site?.origin ?? 'https://libtmux.org', url?.pathname), {
  headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
})
