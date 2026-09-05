/**
 * `/llms-full.txt` — every prose page's Markdown, concatenated.
 *
 * The generated API reference is indexed in llms.txt and deliberately not
 * inlined here; see the note in lib/llms.ts for why.
 */
import type { APIRoute } from 'astro'
import { llmsHeader, llmsPages, referenceLine } from '../lib/llms.ts'

export const GET: APIRoute = async ({ site }) => {
  const origin = (site?.origin ?? 'https://libtmux.org').replace(/\/$/, '')
  const base = import.meta.env.BASE_URL
  const { title, blurb } = llmsHeader()
  const pages = await llmsPages(origin, base)

  const out: string[] = [`# ${title}`, '', `> ${blurb}`, '']
  const reference = referenceLine(origin)
  if (reference) out.push(reference, '')

  for (const page of pages) {
    out.push('---', '', `# ${page.title}`, '', `Source: ${page.url}`, '')
    if (page.description) out.push(`> ${page.description}`, '')
    out.push(page.body.trim(), '')
  }

  return new Response(out.join('\n'), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}
