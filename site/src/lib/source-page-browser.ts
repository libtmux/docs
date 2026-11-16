/**
 * The source page's enhancements. The page is complete without them: the
 * lines are in the HTML, a fragment such as `#L123` scrolls to its line, and
 * the declaration list links to lines. This adds what the address carries
 * that a static page cannot know: the range to highlight, and where Back goes.
 */
import { fromParam, parseLineFragment, rangeLabel, type LineRange } from './source-state'

const BACK_FRAGMENT = '#api-overview'

/** The declaration rows of the list, keyed by the line each is declared on. */
function rowsOf(root: ParentNode) {
  return [...root.querySelectorAll<HTMLAnchorElement>('[data-source-row]')]
}

/** A single line that a declaration starts on names the whole declaration. */
function resolve(range: LineRange, rows: HTMLAnchorElement[]): { range: LineRange; row?: HTMLAnchorElement } {
  if (range[0] === range[1]) {
    const row = rows.find((candidate) => Number(candidate.dataset.line) === range[0])
    if (row) return { range: [Number(row.dataset.from), Number(row.dataset.to)], row }
  }
  const row = rows.find((candidate) => Number(candidate.dataset.from) === range[0] && Number(candidate.dataset.to) === range[1])
  return { range, row }
}

export function mountSourcePage(doc: Document = document): void {
  const body = doc.querySelector<HTMLElement>('[data-source-body]')
  if (!body || body.dataset.mounted) return
  body.dataset.mounted = ''
  const rows = rowsOf(doc)
  const status = doc.querySelector<HTMLElement>('[data-source-range]')
  const github = doc.querySelector<HTMLAnchorElement>('[data-source-github]')
  const githubBase = github?.getAttribute('href')?.split('#')[0]
  const back = doc.querySelector<HTMLAnchorElement>('[data-source-back]')

  const highlight = () => {
    // A router swap replaces the page; this one is gone.
    if (!body.isConnected) { window.removeEventListener('hashchange', highlight); return }
    for (const line of body.querySelectorAll('.hl')) line.classList.remove('hl')
    const range = parseLineFragment(location.hash)
    if (!range) return
    const target = resolve(range, rows)
    const [from, to] = target.range
    for (let n = from; n <= to; n++) body.querySelector(`[data-n="${n}"]`)?.classList.add('hl')
    body.querySelector(`[data-n="${from}"]`)?.scrollIntoView({ block: 'start' })
    if (status) {
      status.textContent = ''
      status.append(`${rangeLabel(target.range)}${target.row ? ' declare ' : '.'}`)
      if (target.row) {
        const code = doc.createElement('code')
        code.textContent = target.row.dataset.title ?? ''
        status.append(code, '.')
      }
    }
    if (github && githubBase) github.href = `${githubBase}#L${from}${to > from ? `-L${to}` : ''}`
  }

  // `from` names a declaration by slug; one that cites this file is in the list, which holds its page.
  const slug = fromParam(location.search)
  if (back && slug) {
    const row = rows.find((candidate) => candidate.dataset.slug === slug)
    const page = row?.dataset.page ?? `${back.dataset.sourceBackBase ?? ''}${slug}/`
    back.href = `${page}${BACK_FRAGMENT}`
    back.textContent = `← Back to ${row?.dataset.title ?? slug}`
  }

  highlight()
  window.addEventListener('hashchange', highlight)
}

document.addEventListener('astro:page-load', () => mountSourcePage())
if (document.readyState !== 'loading') mountSourcePage()
