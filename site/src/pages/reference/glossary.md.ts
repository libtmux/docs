import type { APIRoute } from 'astro'
import { apiGlossaryMarkdown } from '../../lib/api-glossary'

export const GET: APIRoute = ({ site }) =>
  new Response(apiGlossaryMarkdown(site?.origin ?? 'https://libtmux.org'), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  })
