/**
 * A stand-in for Pagefind's index, for the search demo.
 *
 * Pagefind indexes the site after `astro build`, so under `pnpm dev` there is
 * no index and the demo could only say so. These five pages are shaped like
 * Pagefind's results, sections included; a page matches when it contains
 * every word of the query, and matched words are marked as Pagefind marks them.
 */
import type { PagefindApi, PagefindResultData } from './search-panel'

interface MockPage {
  path: string
  title: string
  excerpt: string
  meta?: Record<string, string>
  /** Anchor, title and excerpt of each section. */
  sections: [string, string, string][]
}

const PAGES: MockPage[] = [
  {
    path: 'guides/getting-started/',
    title: 'Getting started',
    excerpt: 'Install a libtmux port, start a tmux server and create a session from code.',
    sections: [
      ['install', 'Install', 'Each port installs from its own registry: pip, npm, cargo, go get, Maven, NuGet, CMake or SwiftPM.'],
      ['run-the-smallest-thing-that-proves-it-works', 'Run the smallest thing that proves it works', 'Start a session named foo, send keys to its pane, and read the output back.'],
    ],
  },
  {
    path: 'concepts/server-session-window-pane/',
    title: 'Server, session, window, pane',
    excerpt: 'tmux nests panes in windows, windows in sessions, and sessions in a server; every port models the same tree.',
    sections: [
      ['server', 'Server', 'A server owns a socket and every session on it.'],
      ['session', 'Session', 'A session groups windows and outlives the client that created it.'],
      ['window', 'Window', 'A window fills the terminal and splits into panes.'],
      ['pane', 'Pane', 'A pane runs one program; send keys to it and capture what it shows.'],
    ],
  },
  {
    path: 'concepts/transports/',
    title: 'Control mode vs one-shot',
    excerpt: 'A port talks to tmux through one long-lived control mode client, or runs a tmux command for each call.',
    sections: [
      ['control-mode', 'Control mode', 'One tmux -C client streams notifications and answers commands in order.'],
      ['one-shot', 'One-shot commands', 'Each call runs tmux once, which is simpler and slower.'],
    ],
  },
  {
    path: 'mcp/tools/',
    title: 'MCP tools',
    excerpt: 'The tools an agent calls through the libtmux MCP server to drive sessions, windows and panes.',
    sections: [
      ['capture_pane', 'capture_pane', 'Read what a pane shows, as lines of text.'],
      ['send_keys', 'send_keys', 'Type keys into a pane, then press Enter if asked.'],
      ['list_sessions', 'list_sessions', 'List the sessions on a server, with their windows and panes.'],
      ['create_session', 'create_session', 'Start a detached session with one pane and return its id.'],
      ['split_window', 'split_window', 'Split a pane in two, side by side or stacked.'],
    ],
  },
  {
    path: 'reference/py/libtmux-session-panes/',
    title: 'libtmux.Session.panes',
    excerpt: 'Every pane in the session, across all of its windows.',
    meta: { package: 'libtmux', file: 'src/libtmux/session.py' },
    sections: [],
  },
]

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** An index over the pages above, linked under the panel's site root. */
export function mockPagefind(bundlePath: string): PagefindApi {
  const siteRoot = bundlePath.replace(/pagefind\/$/, '')
  return {
    async filters() {
      return {}
    },
    async search(query) {
      const terms = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
      if (terms.length === 0) return { results: [] }
      const pattern = new RegExp(`(${terms.map(escape).join('|')})`, 'gi')
      const mark = (text: string) => text.replace(pattern, '<mark>$1</mark>')
      const has = (text: string) => terms.some((term) => text.toLowerCase().includes(term))
      const matches = PAGES.filter((page) => {
        const text = [page.title, page.excerpt, ...page.sections.flat()].join(' ').toLowerCase()
        return terms.every((term) => text.includes(term))
      })
      return {
        results: matches.map((page) => {
          const url = `${siteRoot}${page.path}`
          const data: PagefindResultData = {
            url,
            excerpt: mark(page.excerpt),
            meta: { title: page.title, ...page.meta },
            sub_results: page.sections
              .filter(([, title, excerpt]) => has(title) || has(excerpt))
              .map(([anchor, title, excerpt]) => ({ title, url: `${url}#${anchor}`, excerpt: mark(excerpt) })),
          }
          return { id: page.path, data: async () => data }
        }),
      }
    },
  }
}
