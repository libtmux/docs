import type { APIRoute } from 'astro'
import { API_GLOSSARY_DESCRIPTION, ALL_GLOSSARY_GROUPS, API_GLOSSARY_PATH, API_GLOSSARY_TITLE, apiGlossaryHref } from '../../lib/api-glossary'

export const GET: APIRoute = ({ site }) => {
  const origin = site?.origin ?? 'https://libtmux.org'
  return new Response(JSON.stringify({
    schema: 1,
    title: API_GLOSSARY_TITLE,
    description: API_GLOSSARY_DESCRIPTION,
    url: new URL(API_GLOSSARY_PATH, origin).href,
    groups: ALL_GLOSSARY_GROUPS.map((group) => ({
      ...group,
      terms: group.terms.map((term) => ({ ...term, url: new URL(apiGlossaryHref(term.id)!, origin).href })),
    })),
  }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } })
}
