/**
 * `/llms.txt` — the index an agent fetches before crawling HTML.
 *
 * Shape per llmstxt.org: an H1, a blockquote summary, then link lists under H2
 * sections. Ship it as agent UX, not SEO — `notes/research/10-llms-and-agents.md`
 * records the 2026 evidence that it moves no ranking and does remove agent 404s.
 */
import type { APIRoute } from 'astro'
import { llmsHeader, llmsPages, referenceLine } from '../lib/llms.ts'

export const GET: APIRoute = async ({ site }) => {
  const origin = (site?.origin ?? 'https://libtmux.org').replace(/\/$/, '')
  const base = import.meta.env.BASE_URL
  const { title, blurb } = llmsHeader()
  const pages = await llmsPages(origin, base)

  const out: string[] = [`# ${title}`, '', `> ${blurb}`, '']

  const sections = [...new Set(pages.map((p) => p.section))]
  for (const section of sections) {
    out.push(`## ${section}`, '')
    for (const page of pages.filter((p) => p.section === section)) {
      out.push(`- [${page.title}](${page.url})${page.description ? `: ${page.description}` : ''}`)
    }
    out.push('')
  }

  const reference = referenceLine(origin)
  if (reference) out.push('## Reference', '', reference, '')

  out.push('## Optional', '')
  out.push(
    `- [Full text of every page above](${origin}${base}llms-full.txt): the same prose concatenated, for a single fetch.`,
  )
  out.push('')

  return new Response(out.join('\n'), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}
