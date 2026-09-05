import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CHECKOUTS, LANG_TO_PORT, expand } from '../src/plugins/remark-port-code.mjs'

/**
 * Where the documented examples come from, and how many are checked by anyone.
 *
 * A fence written `\`\`\`python file="examples/quickstart.py"` is read out of
 * that port's own checkout at build time, so the port's test suite is what
 * keeps it honest — the docs cannot drift from code the port itself runs. A
 * fence with the code typed inline has nothing behind it: it renders
 * perfectly while calling a method that was renamed two releases ago.
 *
 * So two things are asserted. Every `file=` reference must resolve, because a
 * renamed example upstream degrades quietly rather than failing. And the count
 * of sourced examples must not fall, because the way this erodes is one
 * convenient inline snippet at a time.
 */
const CONTENT = join(dirname(fileURLToPath(import.meta.url)), '../src/content/docs')

/**
 * How many fences are sourced from a port checkout today.
 *
 * Raise this as examples are converted; it exists to stop the number going
 * the other way. It is not a target — 14 of 236 is poor, and the remaining
 * 222 are unverified by anything.
 */
const SOURCED_FLOOR = 14

interface Fence {
  file: string
  line: number
  lang: string
  source?: string
}

function fences(): Fence[] {
  const files = execFileSync('fd', ['-e', 'md', '.', CONTENT], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)

  const out: Fence[] = []
  for (const path of files) {
    readFileSync(path, 'utf8')
      .split('\n')
      .forEach((text, i) => {
        const m = /^```([a-zA-Z0-9+#-]+)(.*)$/.exec(text)
        if (!m) return
        const lang = m[1].toLowerCase()
        if (!LANG_TO_PORT[lang]) return
        const source = /\bfile="([^"]+)"/.exec(m[2])?.[1]
        out.push({ file: path.replace(`${CONTENT}/`, ''), line: i + 1, lang, source })
      })
  }
  return out
}

const all = fences()
const sourced = all.filter((f) => f.source)

describe('documented examples', () => {
  it('finds the fences at all', () => {
    // The parser is a regex over Markdown; if it silently matched nothing,
    // every assertion below would pass while checking zero examples.
    expect(all.length, 'per-language fences in the content').toBeGreaterThan(100)
  })

  it.each(sourced.map((f) => [`${f.file}:${f.line} ${f.lang}`, f]))(
    '%s resolves in its port checkout',
    (_label, fence: Fence) => {
      // `CHECKOUTS` has literal keys and `LANG_TO_PORT` yields a plain
      // string, so the index needs narrowing as well as a presence check.
      const port = LANG_TO_PORT[fence.lang] as keyof typeof CHECKOUTS | undefined
      expect(port, `a port for ${fence.lang}`).toBeTruthy()
      const checkout = port ? CHECKOUTS[port] : undefined
      expect(checkout, `a checkout for ${port}`).toBeTruthy()

      const abs = join(expand(checkout), fence.source!)
      // A checkout that is not present locally cannot be checked; that is a
      // machine fact, not a docs defect.
      if (!existsSync(expand(checkout))) return
      expect(existsSync(abs), `${fence.source} in ${checkout}`).toBe(true)
    },
  )

  it('does not lose ground on examples sourced from tested code', () => {
    const share = `${sourced.length}/${all.length}`
    expect(sourced.length, `examples sourced from a port checkout (${share})`).toBeGreaterThanOrEqual(
      SOURCED_FLOOR,
    )
  })

  it('reports how much of the corpus nothing verifies, per port', () => {
    // Not a failure — a number, kept visible and attributable. An inline
    // example can be wrong without anything noticing, and one total hides
    // which port is worst placed to fix it.
    //
    // A sourced fence names a file in that port's repository, so the port's
    // own test suite executes it. An inline one is executed by nobody: it is
    // a fragment, not a program, and converting it means finding or writing
    // the example it should have pointed at.
    const byPort = new Map<string, { sourced: number; inline: number }>()
    for (const f of all) {
      const port = LANG_TO_PORT[f.lang] ?? f.lang
      const row = byPort.get(port) ?? { sourced: 0, inline: 0 }
      if (f.source) row.sourced += 1
      else row.inline += 1
      byPort.set(port, row)
    }

    const lines = [...byPort]
      .sort((a, b) => b[1].inline - a[1].inline)
      .map(([port, r]) => `  ${port.padEnd(7)} ${String(r.sourced).padStart(3)} sourced, ${String(r.inline).padStart(3)} inline`)

    console.info(
      `example coverage: ${sourced.length} of ${all.length} sourced from code a port executes\n` +
        lines.join('\n'),
    )
    expect(byPort.size, 'every port appears in the breakdown').toBeGreaterThan(0)
  })
})
