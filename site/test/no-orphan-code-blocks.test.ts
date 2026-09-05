import { existsSync, readFileSync } from 'node:fs'
import { SITE_BUILT, SITE_ROOT } from './site-root'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { describe, expect, it } from 'vitest'

/**
 * A section that shows the same thing in several ports must tab them.
 *
 * Counting groups and tabs is the wrong assertion: `/topics/architecture/`
 * had a seven-tab group and still stranded the Swift block below it, and
 * `concepts/queries.md` showed all eight ports twice under one heading with
 * the second round untabbed. Both read as the serial stack the tabs exist to
 * remove, and both pass any check that only counts groups.
 *
 * But the obvious inversion — "no per-language block may sit outside a
 * panel" — is far too strong, and claims bugs that aren't:
 *
 * - `topics/context-managers.md` gives each language its own `##` heading and
 *   its own prose. Those are sections with their own table-of-contents
 *   entries, not alternatives to switch between.
 * - The same file's "TypeScript, Go, Swift" section is a bulleted list, one
 *   language per bullet with its own explanation. Tabbing across list items
 *   would dismantle the list.
 * - `concepts/queries.md` shows two Python examples under a Python heading.
 *   Two examples in one language are sequential, not alternatives.
 *
 * So the invariant is scoped to a section and to distinct ports: within one
 * heading, counting only direct siblings, two or more *different* ports left
 * outside a panel means a group failed to form.
 */
const SITE = SITE_ROOT

/** Languages that map to a port, mirroring `remark-port-code.mjs`. */
const PORT_LANGS = new Set([
  'python', 'py', 'typescript', 'ts', 'javascript', 'js', 'rust', 'rs',
  'go', 'golang', 'java', 'kotlin', 'csharp', 'cs', 'c#', 'cpp', 'c++',
  'cxx', 'swift',
])

const pages = SITE_BUILT && existsSync(join(SITE, 'topics'))
  ? execFileSync('fd', ['-t', 'f', 'index.html', join(SITE, 'topics'), join(SITE, 'concepts')], {
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(Boolean)
  : []

/**
 * The fence's language.
 *
 * expressive-code rewrites the block: by the time it is HTML the
 * `language-*` class is gone and the language is on `<pre data-language>`.
 * Reading only the class finds nothing and passes every page.
 */
function languageOf(pre: Element): string | undefined {
  const attr = pre.getAttribute('data-language')
  if (attr) return attr.toLowerCase()
  const cls = [...(pre.querySelector('code')?.classList ?? [])]
    .map((c) => /^language-(.+)$/.exec(c)?.[1])
    .find(Boolean)
  return cls?.toLowerCase()
}

interface Section {
  heading: string
  tabbed: number
  untabbed: string[]
}

function sectionsOf(document: Document): Section[] {
  const root = document.querySelector('article') ?? document.querySelector('main') ?? document.body
  const sections: Section[] = [{ heading: '(top)', tabbed: 0, untabbed: [] }]

  const walk = (el: Element) => {
    for (const node of [...el.children]) {
      if (/^H[1-6]$/.test(node.tagName)) {
        sections.push({ heading: node.textContent?.trim() ?? '', tabbed: 0, untabbed: [] })
        continue
      }
      if (node.tagName === 'PRE') {
        const lang = languageOf(node)
        if (!lang || !PORT_LANGS.has(lang)) continue
        const section = sections[sections.length - 1]
        if (node.closest('.code-tab-panel')) section.tabbed += 1
        else section.untabbed.push(lang)
        continue
      }
      // A fence inside a list belongs to its bullet, which carries its own
      // prose; it can never join a sibling run.
      if (node.tagName === 'UL' || node.tagName === 'OL') continue
      walk(node)
    }
  }

  walk(root)
  return sections
}

const describeIfBuilt = pages.length ? describe : describe.skip

describeIfBuilt('rendered pages', () => {
  it.each(pages.map((p) => [p.replace(SITE, ''), p]))(
    '%s tabs every section that shows more than one port',
    (label, file) => {
      const window = new Window({ url: 'https://libtmux.org' })
      const document = window.document as unknown as Document
      document.write(readFileSync(file, 'utf8'))

      const failures = sectionsOf(document)
        .filter((s) => new Set(s.untabbed).size > 1 || (s.untabbed.length === 1 && s.tabbed > 0))
        .map((s) => `${s.heading}: untabbed ${s.untabbed.join(', ')}`)

      expect(failures, `${label}: sections showing several ports without tabs`).toEqual([])
    },
  )
})
