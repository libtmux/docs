import { visit } from 'unist-util-visit'
import { LANG_TO_PORT } from './remark-port-code.mjs'

/**
 * Group consecutive per-language code blocks into one tabbed block.
 *
 * The root build keeps every port's fence, which is the whole point of the
 * cross-language view — but "keeps" was rendering as eight code blocks stacked
 * vertically, so `/topics/architecture/` asked the reader to scroll past seven
 * languages to reach theirs. Playwright, which this site follows, shows one
 * block and a row of tabs.
 *
 * It runs inside this project's own `unified()` processor, which sits *before*
 * expressive-code — so a fence here is still a plain `pre > code.language-x`,
 * not the `div.expressive-code` it eventually becomes. That ordering is what
 * makes the wrapping work at all: expressive-code walks the tree afterwards
 * and renders each `<pre>` where it now sits, inside a panel.
 *
 * A run of one is left alone: in a port build there is exactly one fence left,
 * and a single tab is a worse control than no control.
 */

/** The language of a `pre > code.language-x` block, if it is one. */
function languageOf(node) {
  if (node?.type !== 'element' || node.tagName !== 'pre') return undefined
  const code = node.children?.find((c) => c.type === 'element' && c.tagName === 'code')
  const classes = code?.properties?.className
  const list = Array.isArray(classes) ? classes : typeof classes === 'string' ? [classes] : []
  for (const cls of list) {
    const match = /^language-(.+)$/.exec(String(cls))
    if (match) return match[1].toLowerCase()
  }
  return undefined
}

/** Display name per port, matching the port switcher's labels. */
const PORT_LABEL = {
  py: 'Python',
  ts: 'TypeScript',
  rs: 'Rust',
  go: 'Go',
  java: 'Java',
  dotnet: '.NET',
  cxx: 'C++',
  swift: 'Swift',
}

export function rehypeCodeTabs() {
  return (tree) => {
    // Both `root` and `element`: in a rendered Markdown fragment the top-level
    // blocks are children of the hast root, which is not an element — so
    // visiting elements alone finds every nested case and misses the only one
    // that actually occurs.
    visit(tree, (node) => {
      if (node.type !== 'root' && node.type !== 'element') return
      if (!Array.isArray(node.children)) return

      const out = []
      let run = []

      const flush = () => {
        if (run.length < 2) {
          out.push(...run.map((r) => r.node))
          run = []
          return
        }
        out.push({
          type: 'element',
          tagName: 'libtmux-code-tabs',
          properties: { class: 'code-tabs', 'data-ports': run.map((r) => r.port).join(',') },
          children: [
            {
              type: 'element',
              tagName: 'div',
              properties: { class: 'code-tabs-list', role: 'tablist' },
              children: run.map((r, i) => ({
                type: 'element',
                tagName: 'button',
                properties: {
                  class: 'code-tab',
                  type: 'button',
                  role: 'tab',
                  'data-port': r.port,
                  'aria-selected': i === 0 ? 'true' : 'false',
                  tabindex: i === 0 ? 0 : -1,
                },
                children: [{ type: 'text', value: PORT_LABEL[r.port] ?? r.port }],
              })),
            },
            ...run.map((r, i) => ({
              type: 'element',
              tagName: 'div',
              properties: {
                class: 'code-tab-panel',
                role: 'tabpanel',
                'data-port': r.port,
                hidden: i === 0 ? undefined : true,
              },
              children: [...(r.lead ?? []), r.node],
            })),
          ],
        })
        run = []
      }

      // Prose sitting between two port fences belongs to the fence it
      // introduces, not to the group. `topics/architecture.md` has seven
      // fences, then a paragraph explaining why Swift's shape differs, then
      // the Swift fence — and breaking the run at that paragraph stranded
      // Swift outside the tabs as a bare block, which is exactly the serial
      // rendering this plugin exists to remove. It is held back and emitted
      // inside the panel it belongs to.
      let pending = []

      for (const child of node.children) {
        const lang = languageOf(child)
        const port = lang ? LANG_TO_PORT[lang] : undefined

        // Only fences that belong to a port are tabbable, and a port already
        // in the run closes it: two Python blocks in a row are two examples,
        // not two tabs, and silently dropping the second would lose content.
        //
        // The repeated fence opens the next run rather than being emitted on
        // its own. `concepts/queries.md` shows all eight ports, then shows
        // them again under the same heading; closing the run and pushing the
        // second Python block out as a bare `<pre>` left that whole second
        // round untabbed — the same serial rendering, one heading further
        // down the page.
        if (port) {
          if (!run.some((r) => r.port === port)) {
            run.push({ node: child, port, lead: pending })
            pending = []
            continue
          }
          flush()
          out.push(...pending)
          run.push({ node: child, port, lead: [] })
          pending = []
          continue
        }

        // Whitespace between block elements never breaks a run.
        if (child.type === 'text' && !child.value.trim()) {
          if (run.length || pending.length) pending.push(child)
          else out.push(child)
          continue
        }

        // A heading always breaks the run: it opens a new section, and a tab
        // group spanning one would take the heading out of the page's table
        // of contents.
        const isHeading =
          child.type === 'element' && /^h[1-6]$/.test(String(child.tagName))

        // A paragraph while a run is open is a caption for whatever comes
        // next — held, not flushed. If the next thing is not a fence, it is
        // released untouched when the run closes.
        if (!isHeading && run.length && child.type === 'element' && child.tagName === 'p') {
          pending.push(child)
          continue
        }

        flush()
        out.push(...pending)
        pending = []
        out.push(child)
      }
      flush()
      out.push(...pending)
      flush()
      node.children = out
    })
  }
}
