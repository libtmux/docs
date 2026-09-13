import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mentionedIn, seed } from '../src/db'
import { MODEL_DIR } from '../src/db/paths'
import mentionIndex from '../src/data/mentions.json'

/**
 * The backlink index: which prose mentions a symbol.
 *
 * Driven from a written index rather than the published one, so the rows under
 * test are known. Every seed rebuilds the whole API store, so this keeps to
 * the two answers a symbol page renders: which pages mention it, and never
 * another port's.
 *
 * The rows come from `site/src/data/mentions.json`, computed before the build.
 * A render-time recorder was the obvious alternative and is the wrong one: it
 * observes nothing on a cached build and reports that as "no mentions", which
 * is indistinguishable from prose that genuinely stopped referring to the API.
 */
const hasModels = existsSync(join(MODEL_DIR, 'py.json'))
const describeIfSeeded = hasModels ? describe : describe.skip

function mentionsFile(mentions: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'libtmux-mentions-'))
  const path = join(dir, 'mentions.json')
  writeFileSync(path, JSON.stringify({ generated: new Date().toISOString(), mentions }))
  return path
}

describeIfSeeded('prose mention index', () => {
  it('does not turn language types into unrelated API backlinks', () => {
    for (const [port, symbol, page] of [
      ['swift', 'JSONValue.bool(_:)', '/topics/socket-and-servers/'],
      ['dotnet', 'LibTmux.ControlModeGuardKind.Error', '/topics/errors-and-exceptions/'],
    ]) {
      expect(mentionIndex.mentions.some((row) => row.port === port && row.symbol === symbol && row.page === page)).toBe(false)
    }
  })

  it('answers which pages mention a symbol', () => {
    const result = seed({
      mentionsPath: mentionsFile([
        {
          port: 'py',
          symbol: 'libtmux.Pane.capture_pane',
          page: '/topics/traversal/',
          title: 'Traversal',
          section: 'topics',
        },
        {
          port: 'py',
          symbol: 'libtmux.Pane.capture_pane',
          page: '/concepts/server-session-window-pane/',
          title: 'Server, session, window, pane',
          section: 'concepts',
        },
        { port: 'rs', symbol: 'pane.observe.Pane.capture', page: '/topics/traversal/' },
      ]),
    })

    expect(result.mentions, 'rows indexed').toBe(3)

    const found = mentionedIn('py', 'libtmux.Pane.capture_pane')
    expect(found.map((m) => m.page)).toEqual([
      '/concepts/server-session-window-pane/',
      '/topics/traversal/',
    ])
    expect(found[0].title).toBe('Server, session, window, pane')
  })

  it('does not answer for another port', () => {
    // Ids are unique within a port, never globally, so a mention keyed only by
    // symbol would attach Python's backlinks to Rust's page.
    seed({
      mentionsPath: mentionsFile([
        { port: 'py', symbol: 'libtmux.Pane.capture_pane', page: '/topics/traversal/' },
      ]),
    })
    expect(mentionedIn('rs', 'libtmux.Pane.capture_pane')).toEqual([])
  })

  it('restores the published state for the other suites', () => {
    seed()
  })
})
