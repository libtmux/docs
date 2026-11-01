import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { proseTexts, SymbolIndex, type ApiSymbol } from '@libtmux/api-model'
import { TYPE_KINDS } from '../../packages/api-model/src/link'
import { API_MODELS } from '../src/lib/api-models'
import { defaultVersionFor } from '../src/lib/versions'
import { productApiIndex } from '../src/lib/product-api'
import { linkTmuxDoc } from '../src/lib/tmux-links'

/**
 * A literal that resolves to nothing whole is linked name by name. Calling it a call keeps a bare argument from
 * linking to an unrelated member, and must not cost any other link: this holds the new linker to what the
 * previous one linked, over every such literal in every port's model. The drops are deliberate: a bare value that
 * matched an unrelated member, a control-mode marker such as `%end` that linked the member named `end`, a kebab-case
 * word such as `control-mode` that linked the member named `mode`, and what the two guards remove (a file path such
 * as `src/main/java/ListWindows.java` that linked the member named `main`, and a plain lowercase word that is only
 * the short name of a member of another type, `server` linking `TestServer::server`). The guards are judged by the
 * next comparison, which pins every link they drop. A kebab-case tmux command, option or hook is named whole by the
 * tmux linker before a page draws the parts of its literal, so most of those drops cost a reader nothing; the ones it
 * does not name are listed below, so that a new one is recorded here and not lost without notice.
 */
const indexes: Record<string, SymbolIndex> = Object.fromEntries(Object.entries(API_MODELS).map(([port, model]) => [port, productApiIndex(model, defaultVersionFor(port))]))
const KEYWORD = /^[A-Za-z_]\w*[?!]?:(?:\s|$)/
/** A tmux control-mode marker: a protocol line, whose words are no member's. */
const MARKER = /^%[\w-]+$/
/** A kebab-case word: one name, not two members around a minus. */
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)+$/
/** The kebab-case literals no tmux name claims whole, each of which linked a word of it to an unrelated member. */
const UNCLAIMED_KEBAB = [
  'julia libtmux-workspace', 'rs copy-mode-vi', 'rs even-horizontal', 'rs global-session', 'rs global-window', 'rs main-horizontal', 'rs tree-mode',
]

interface Link { text: string; href: string; offset: number; kind?: string; symbol?: ApiSymbol }
const linksOf = (spans: { text: string; link?: { href: string; symbol?: ApiSymbol } }[]): Link[] => {
  let offset = 0
  return spans.flatMap((span) => {
    const here = offset
    offset += span.text.length
    return span.link ? [{ text: span.text, href: span.link.href, offset: here, kind: span.link.symbol?.kind, symbol: span.link.symbol }] : []
  })
}

type Guarded = Record<'isPathLiteral' | 'isAnotherOwnersMember', () => boolean>

/** Run `run` with what keeps a link beside a type's own members switched off: the guard with only its first rule. */
function withoutKeeps<T>(run: () => T): T {
  const keeps = SymbolIndex.prototype as unknown as Record<'isRelated' | 'isCall', () => boolean>
  const off = [vi.spyOn(keeps, 'isRelated').mockReturnValue(false), vi.spyOn(keeps, 'isCall').mockReturnValue(false)]
  try { return run() } finally { for (const spy of off) spy.mockRestore() }
}

/** Run `run` with the two guards switched off: the linker as it was before them. */
function withoutGuards<T>(run: () => T): T {
  const guards = SymbolIndex.prototype as unknown as Guarded
  const off = [vi.spyOn(guards, 'isPathLiteral').mockReturnValue(false), vi.spyOn(guards, 'isAnotherOwnersMember').mockReturnValue(false)]
  try { return run() } finally { for (const spy of off) spy.mockRestore() }
}

/** Whether `link` is a bare name inside parentheses that is a member and not a type: the caller's own value. */
const isValue = (label: string, link: Link) => {
  const before = label.slice(0, link.offset)
  const depth = [...before].reduce((open, char) => Math.max(0, open + (char === '(' ? 1 : char === ')' ? -1 : 0)), 0)
  return depth > 0 && link.kind !== undefined && !TYPE_KINDS.has(link.kind as never) && !/[.:#/]/.test(link.text) && !/[.:#/>]$/.test(before.trimEnd())
}

function compare() {
  const tally = { literals: 0, calls: 0, before: 0, after: 0, values: 0, markers: 0, kebab: 0, guarded: 0, claimed: 0, unclaimed: new Set<string>(), lost: [] as string[], gained: 0 }
  const entries: { port: string; symbol: ApiSymbol; label: string; previous: Link[]; current: Link[]; unguarded: Link[] }[] = []
  for (const [port, model] of Object.entries(API_MODELS)) {
    const index = indexes[port]
    for (const symbol of model.symbols as ApiSymbol[]) {
      for (const { text } of proseTexts(symbol)) {
        for (const span of index.linkText(text, symbol)) {
          if (span.kind !== 'ref' || span.link) continue
          const label = span.label
          tally.literals++
          if (label.includes('(')) tally.calls++
          const previous = linksOf(KEYWORD.test(label) ? [{ text: label }] : index.linkType(label, symbol))
          const current = linksOf(index.linkLiteral(label, symbol))
          tally.before += previous.length
          tally.after += current.length
          entries.push({ port, symbol, label, previous, current, unguarded: [] })
        }
      }
    }
  }
  // What the guards alone remove is what the same linker links with them off.
  withoutGuards(() => { for (const entry of entries) entry.unguarded = linksOf(indexes[entry.port].linkLiteral(entry.label, entry.symbol)) })
  for (const { port, label, previous, current, unguarded } of entries) {
    const has = (links: Link[], link: Link) => links.some((other) => other.offset === link.offset && other.href === link.href)
    for (const link of previous.filter((entry) => !has(current, entry))) {
      if (MARKER.test(label)) tally.markers++
      else if (KEBAB.test(label)) {
        tally.kebab++
        // The tmux linker takes a name whole, as the page does before it draws the parts of a literal.
        if (linkTmuxDoc([{ kind: 'ref', role: 'any', target: label, label }])[0]?.kind === 'link') tally.claimed++
        else tally.unclaimed.add(`${port} ${label}`)
      } else if (has(unguarded, link)) tally.guarded++
      else if (isValue(label, link)) tally.values++
      else tally.lost.push(`${port} ${label} lost ${link.text}`)
    }
    tally.gained += current.filter((link) => !has(previous, link)).length
  }
  return tally
}

describe('the literals a reference page links name by name', () => {
  const tally = compare()

  it('lose no link the previous linker made, except a bare value inside a call\'s parentheses, a control-mode marker, a kebab-case word and what the guards remove', () => {
    expect(tally.lost).toEqual([])
  })

  it('still drop that value, those markers and words and what the guards remove, so the comparison above is tested against the cases it exists for', () => {
    expect(tally.values).toBeGreaterThan(0)
    expect(tally.markers).toBeGreaterThan(0)
    expect(tally.kebab).toBeGreaterThan(0)
    expect(tally.guarded).toBeGreaterThan(0)
    expect(tally.after).toBe(tally.before - tally.values - tally.markers - tally.kebab - tally.guarded + tally.gained)
  })

  it('name every kebab-case word that no tmux name claims, and find the rest claimed by the tmux linker', () => {
    expect([...tally.unclaimed].sort()).toEqual(UNCLAIMED_KEBAB)
    expect(tally.claimed).toBeGreaterThan(tally.kebab / 2)
  })

  it('cover signature-style references, chained calls and nested arguments across the ports', () => {
    expect(tally.literals).toBeGreaterThan(1000)
    expect(tally.calls).toBeGreaterThan(100)
  })
})

/**
 * The same comparison over everything a reference page links in doc prose, not only the literals that resolve
 * nowhere whole: every reference a symbol's documentation holds, whole or by the parts of its literal, as `ApiDoc`
 * renders it. The previous linker is this one with its two guards off. `fixtures/literal-links-dropped.json` lists
 * every link the guards remove: the page, the literal, the word that linked and the declaration it reached. A row that
 * is a link a reader should have carries the `reason` it is lost. `fixtures/literal-links-kept.json` lists every link
 * the guard keeps only because of a page's own types or a call (`isRelated`, `isCall`): a link that a word shares with
 * a member of an unrelated type is a false link, and these are the ones a person read and found true. The test fails
 * when either set changes, so a model that gains a new false link, a guard that starts to remove a true one and a keep
 * that lets a false link back all stop here to be read. After reading the new rows, rewrite the files with
 * `LIBTMUX_DOCS_UPDATE_FIXTURES=1 pnpm exec vitest run test/literal-links.test.ts`.
 */
interface Row { key: string; port: string; referrer: ApiSymbol; label: string; text: string; target: ApiSymbol | undefined; href: string }
interface Dropped { port: string; symbol: string; literal: string; word: string; target: string; reason?: string }

function prose(): Row[] {
  const rows: Row[] = []
  for (const [port, model] of Object.entries(API_MODELS)) {
    const index = indexes[port]
    for (const [position, referrer] of (model.symbols as ApiSymbol[]).entries()) {
      for (const [item, { text, field }] of proseTexts(referrer).entries()) {
        let at = 0
        for (const span of index.docSpans(text, referrer)) {
          at++
          if (span.kind !== 'ref') continue
          const add = (shown: string, link: { href: string; symbol?: ApiSymbol }, part: number) =>
            rows.push({ key: `${port} ${position} ${item} ${field} ${at}.${part}`, port, referrer, label: span.label, text: shown, target: link.symbol, href: link.href })
          if (span.link) add(span.label, span.link, 0)
          else (span.parts ?? []).forEach((part, position) => { if (part.link) add(part.text, part.link, position + 1) })
        }
      }
    }
  }
  return rows
}

function compareProse() {
  const after = prose()
  const before = withoutGuards(prose)
  const kept = new Map(after.map((row) => [row.key, row.href]))
  const dropped = before.filter((row) => kept.get(row.key) !== row.href)
  const present = new Set(before.map((row) => `${row.key} ${row.href}`))
  const bare = new Set(withoutKeeps(prose).map((row) => `${row.key} ${row.href}`))
  return {
    before, after, dropped, gained: after.filter((row) => !present.has(`${row.key} ${row.href}`)),
    kept: after.filter((row) => !bare.has(`${row.key} ${row.href}`)),
  }
}

/** The links that are real and that the guard still loses, and why. Each key is `port symbol literal word`. */
const KNOWN_LOSSES: Record<string, string> = {
  'ts common.LogicalRef kind kind': 'LogicalRef is a union of types that extend LogicalRefBase, which declares kind, and the TypeScript model records no extends: nothing relates the alias to the base type',
  'julia LibTmux.get_environment hidden=true hidden': 'the function gives back an EnvironmentValue, and the Julia model records no return type for it',
  'cxx libtmux::ExecutorOptions refuses refuses': 'ServerCapabilities::refuses, reached through Server::capabilities(), which the same sentence names in another literal with no argument to say it is called',
  'cxx libtmux::ExecutorOptions supports supports': 'ServerCapabilities::supports, reached through Server::capabilities(), which the same sentence names in another literal with no argument to say it is called',
  'ts client.ClientRow format format': 'ClientRow is built from the fields of the Client handle and its docs send the reader to Client.format; the model does not relate an alias to the handle it is built for',
  'ts pane.PaneRow format format': 'PaneRow is built from the fields of the Pane handle and its docs send the reader to Pane.format; the model does not relate an alias to the handle it is built for',
  'ts session.SessionRow format format': 'SessionRow is built from the fields of the Session handle and its docs send the reader to Session.format; the model does not relate an alias to the handle it is built for',
  'ts window.WindowRow format format': 'WindowRow is built from the fields of the Window handle and its docs send the reader to Window.format; the model does not relate an alias to the handle it is built for',
}

const FIXTURE = new URL('./fixtures/literal-links-dropped.json', import.meta.url)
const KEPT = new URL('./fixtures/literal-links-kept.json', import.meta.url)
const listing = (rows: Row[], reasons: Record<string, string> = {}): Dropped[] => rows
  .map((row) => {
    const reason = reasons[`${row.port} ${row.referrer.id} ${row.label} ${row.text}`]
    return { port: row.port, symbol: row.referrer.id, literal: row.label, word: row.text, target: row.target?.id ?? row.href, ...(reason ? { reason } : {}) }
  })
  .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
/** One row to a line, so that a change to the set is a change to those lines. */
const written = (rows: Dropped[]) => `[\n${rows.map((row) => `  ${JSON.stringify(row)}`).join(',\n')}\n]\n`
/** The rows that only one of the two lists holds. */
const difference = (expected: Dropped[], actual: Dropped[]) => {
  const count = (rows: Dropped[]) => rows.reduce((tally, row) => tally.set(JSON.stringify(row), (tally.get(JSON.stringify(row)) ?? 0) + 1), new Map<string, number>())
  const have = count(expected)
  const got = count(actual)
  return [
    ...[...got].filter(([key, n]) => n > (have.get(key) ?? 0)).map(([key]) => `+ ${key}`),
    ...[...have].filter(([key, n]) => n > (got.get(key) ?? 0)).map(([key]) => `- ${key}`),
  ]
}

describe('the links a reference page draws in doc prose', () => {
  const found = compareProse()
  const dropped = listing(found.dropped, KNOWN_LOSSES)
  const kept = listing(found.kept)
  if (process.env.LIBTMUX_DOCS_UPDATE_FIXTURES) {
    writeFileSync(FIXTURE, written(dropped))
    writeFileSync(KEPT, written(kept))
  }
  const reviewed = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Dropped[]
  const keeps = JSON.parse(readFileSync(KEPT, 'utf8')) as Dropped[]
  const named = (row: Dropped) => `${row.port} ${row.symbol}: ${row.word} -> ${row.target}`

  it('lose exactly the links the reviewed list holds', () => {
    expect(difference(reviewed, dropped)).toEqual([])
  })

  it('lose a real link only where the list says why', () => {
    expect(reviewed.filter((row) => row.reason).map((row) => `${row.port} ${row.symbol} ${row.literal} ${row.word}`).sort()).toEqual(Object.keys(KNOWN_LOSSES).sort())
  })

  it('keep, beside a type\'s own members, exactly the links the reviewed list holds', () => {
    expect(difference(keeps, kept)).toEqual([])
    expect(keeps.length).toBeGreaterThan(5)
  })

  it('gain no link', () => {
    expect(found.gained.map((row) => `${row.port} ${row.referrer.id}: ${row.text} -> ${row.target?.id ?? row.href}`)).toEqual([])
    expect(found.after.length).toBe(found.before.length - found.dropped.length)
  })

  it('drop the links on the pages that showed them', () => {
    const pages = reviewed.map(named)
    expect(pages).toContain('java io.github.libtmux.Session.Session.windows: main -> io.github.libtmux.mcp.Main.Main.main')
    expect(pages).toContain('rs mcp.model.OptionArgs.scope: server -> test.TestServer.server')
    expect(pages).toContain('rs mcp.model.OptionArgs.scope: pane -> mcp.tail.Cursor.pane')
  })

  it('keep dropped what a rule that keeps links must not bring back: an internal member, a parameter, a word in a phrase', () => {
    const pages = reviewed.map(named)
    // `server` of `Server::from_env` is not `detail::Row::server`; `schema`, the parameter of a Lua query, is not QueryRelation's field.
    expect(pages).toContain('cxx libtmux::Server::from_env: server -> libtmux::detail::Row::server')
    expect(pages.filter((page) => /^lua libtmux\.query\.\w+: schema -> libtmux\.QueryRelation\.schema$/.test(page))).toHaveLength(8)
    // `client` in `struct client`, `control` and `panes` of a Kotlin sample are the words of a phrase and a variable.
    expect(pages).toContain('rs client.Client.attached_window: client -> server.Server.client')
    expect(pages).toContain('kotlin io.github.libtmux.kotlin.ControlClient.output: control -> io.github.libtmux.kotlin.Server.control')
    expect(pages).toContain('kotlin io.github.libtmux.kotlin.Iterable.filter: panes -> io.github.libtmux.kotlin.Server.panes')
    // And no kept link reaches into the library's internals.
    expect(keeps.filter((row) => /(?:^|[.:])detail(?:[.:]|$)/.test(row.target))).toEqual([])
  })

  it('drop no identifier: a word with an underscore, an inner capital or a qualifier says which declaration it means', () => {
    const words = reviewed.filter((row) => !row.literal.includes('/')).map((row) => row.word.replace(/\(\)$/, ''))
    expect(words.length).toBeGreaterThan(50)
    expect(words.filter((word) => !/^[a-z][a-z0-9]*$/.test(word))).toEqual([])
    // The identifiers the old rule dropped link again.
    const linked = new Set(found.after.map((row) => row.text))
    for (const word of ['typed_global_option', 'send_keys', 'list_sessions']) expect(linked.has(word), word).toBe(true)
  })

  it('keep the members of a type that a page\'s own types name, which are not the other type\'s by name alone', () => {
    const links = new Set(keeps.map((row) => `${row.port} ${row.symbol}: ${row.word}`))
    for (const link of [
      'cxx libtmux::CommandRuntime::wait_ready: closed', 'cxx libtmux::Server::run: truncated', 'cxx libtmux::Session::expand: missing',
      'cxx libtmux::Window::expand: missing', 'cxx libtmux::as_command_failure: pipe', 'cxx libtmux::CommandRuntimeShutdown: close',
      'julia LibTmux.snapshot: acquired',
    ]) expect(links.has(link), link).toBe(true)
  })

  it('keep a word that is called with an argument or whose result is used', () => {
    const links = new Set(keeps.map((row) => `${row.port} ${row.symbol}: ${row.literal} ${row.word}`))
    expect(links.has('ts selection.StringFilterFields: where({ active: true }) where')).toBe(true)
    expect(links.has('cxx libtmux::ExecutorOptions: capabilities().supports(...) capabilities')).toBe(true)
    // A bare `iter()` or `close()` is as likely the method of another type.
    const pages = reviewed.map(named)
    expect(pages).toContain('rs query.QueryIteratorExt.matching_owned: iter() -> hooks.SparseValues.iter')
  })

  it('still link a type by its name', () => {
    expect(found.after.filter((row) => row.target && ['class', 'struct', 'interface', 'enum', 'trait', 'typealias', 'exception'].includes(row.target.kind)).length).toBeGreaterThan(1000)
  })

  it('is checked against a list that has lost or gained a row', () => {
    expect(difference(reviewed.slice(1), dropped)).toHaveLength(1)
    expect(difference([...reviewed, { ...reviewed[0]!, word: 'unlisted' }], dropped)).toHaveLength(1)
    expect(difference(keeps.slice(1), kept)).toHaveLength(1)
  })
})
