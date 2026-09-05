import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mentionedIn, mentionsOn, seed } from '../src/db'
import { MODEL_DIR } from '../src/db/paths'

/**
 * The backlink index: which prose mentions a symbol.
 *
 * Driven from a written index rather than the published one, because the two
 * things worth asserting are both about what happens at the edges — an index
 * that has not been generated, and one that repeats itself — and neither is
 * observable against whatever the real generator last produced.
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

  it('lists what one page covers', () => {
    seed({
      mentionsPath: mentionsFile([
        { port: 'py', symbol: 'libtmux.Pane.capture_pane', page: '/topics/traversal/' },
        { port: 'go', symbol: 'tmux.Pane.Capture', page: '/topics/traversal/' },
        { port: 'py', symbol: 'libtmux.Server', page: '/concepts/' },
      ]),
    })
    expect(mentionsOn('/topics/traversal/').map((m) => m.port)).toEqual(['go', 'py'])
  })

  it('counts a repeated mention once', () => {
    // A symbol named twice on one page is one backlink, not two.
    const result = seed({
      mentionsPath: mentionsFile([
        { port: 'py', symbol: 'libtmux.Server', page: '/concepts/' },
        { port: 'py', symbol: 'libtmux.Server', page: '/concepts/' },
      ]),
    })
    expect(result.mentions).toBe(1)
    expect(mentionedIn('py', 'libtmux.Server')).toHaveLength(1)
  })

  it('drops a row missing the fields a backlink needs', () => {
    const result = seed({
      mentionsPath: mentionsFile([
        { port: 'py', symbol: 'libtmux.Server', page: '/concepts/' },
        { port: 'py', symbol: '', page: '/concepts/' },
        { port: '', symbol: 'libtmux.Server', page: '/concepts/' },
        { port: 'py', symbol: 'libtmux.Server' },
      ]),
    })
    expect(result.mentions, 'only the complete row').toBe(1)
  })

  it('reports an absent index as absent, not as zero mentions', () => {
    // The distinction the dangling-reference report had to learn twice: a
    // generator that never ran and content that mentions nothing produce the
    // same empty table, and only one of them is a problem.
    const result = seed({ mentionsPath: join(tmpdir(), 'libtmux-no-such-mentions.json') })
    expect(result.mentions).toBeUndefined()
    expect(mentionedIn('py', 'libtmux.Server')).toEqual([])
  })

  it('restores the published state for the other suites', () => {
    seed()
  })
})
