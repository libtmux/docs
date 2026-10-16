import type { APIRoute } from 'astro'
import { apiGlossary } from '../../lib/api-glossary'

export const GET: APIRoute = ({ site, url }) => {
  const origin = site?.origin ?? 'https://libtmux.org'
  const glossary = apiGlossary(url?.pathname)
  return new Response(JSON.stringify({
    schema: 1,
    title: glossary.title,
    description: glossary.description,
    url: new URL(glossary.path, origin).href,
    groups: glossary.groups.map((group) => ({
      ...group,
      terms: group.terms.map((term) => ({ ...term, url: new URL(`${glossary.path}#${term.id}`, origin).href })),
    })),
  }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } })
}
