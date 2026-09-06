import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Resolver, notASymbol } from '../src/resolver.ts'
import { tokenizeDoc, docSummaryText } from '../src/doc/roles.ts'
import { javadocToMarkdown, parseJavadoc } from '../src/doc/javadoc.ts'
import { tableMentions } from '../src/mentions.ts'
import { readInventory, writeInventory } from '../src/inventory.ts'
import type { ApiModel } from '../src/model.ts'

const here = dirname(fileURLToPath(import.meta.url))
const DATA = join(here, '../../../site/src/data/api')
const PORTS = ['py', 'ts', 'rs', 'go', 'java', 'dotnet', 'cxx', 'swift'] as const

function load(port: string): ApiModel | undefined {
  const path = join(DATA, `${port}.json`)
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as ApiModel) : undefined
}

/** Whether `uv` can run Sphinx here. Absent on a machine without it. */
function sphinxAvailable(): boolean {
  try {
    execFileSync('uv', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe('Sphinx itself can read every inventory we write', () => {
  /**
   * Our reader is not evidence that our writer is right.
   *
   * `readInventory` and `writeInventory` were written together from the same
   * reading of the format, so a shared misunderstanding round-trips perfectly
   * and fails only in Sphinx. This loads each file with
   * `sphinx.util.inventory.InventoryFile.load` — the code that will actually
   * consume these files — and compares what it finds against the model.
   *
   * The header is as load-bearing as the body: four plaintext lines, the
   * fourth naming the compression, then zlib. Sphinx rejects the file outright
   * if any of that is wrong, which is a better failure than a silently empty
   * inventory.
   */
  const canRun = sphinxAvailable()

  it.runIf(canRun).each(PORTS)('%s loads in Sphinx with every entry intact', (port) => {
    const model = load(port)
    if (!model) return

    const bytes = writeInventory(model, {
      project: `libtmux-${port}`,
      version: 'test',
      uriFor: (s) => `reference/${port}/#${s.publicId ?? s.id}`,
    })
    const dir = mkdtempSync(join(tmpdir(), 'libtmux-inv-'))
    const file = join(dir, 'objects.inv')
    writeFileSync(file, bytes)

    const script = `
import json, sys
from sphinx.util.inventory import InventoryFile
with open(sys.argv[1], "rb") as fh:
    inv = InventoryFile.load(fh, "https://libtmux.org/", lambda base, uri: base + uri)
count = sum(len(entries) for entries in inv.values())
names = sorted({name for entries in inv.values() for name in entries})
print(json.dumps({"count": count, "domains": sorted(inv), "sample": names[:3]}))
`
    const out = execFileSync(
      'uv',
      ['run', '--with', 'sphinx', 'python', '-c', script, file],
      { encoding: 'utf8', timeout: 120_000 },
    )
    const result = JSON.parse(out.trim().split('\n').pop() ?? '{}') as {
      count: number
      domains: string[]
      sample: string[]
    }

    expect(result.count, `${port}: Sphinx read a different number of entries`).toBe(
      model.symbols.length,
    )
    expect(result.domains.length, `${port}: no domains`).toBeGreaterThan(0)
  })
})

describe('names are representable', () => {
  /**
   * An inventory record is whitespace-delimited, so a name containing a space
   * cannot be written at all.
   *
   * Java's inventory was two entries short because the extractor had put a
   * field's initialiser into its name —
   * `DEFAULT_MAX_REPLY_BYTES = 16 * 1024 * 1024`. The writer throws on this
   * now, which then caught Rust's `&'values SparseValues` and C++'s
   * `std::hash< libtmux::Pane >`. This asserts it at the source instead of
   * waiting for the writer to refuse.
   */
  it.each(PORTS)('%s has no whitespace in any name or id', (port) => {
    const model = load(port)
    if (!model) return
    const bad = model.symbols.filter(
      (s) => /\s/.test(s.name) || /\s/.test(s.id) || /\s/.test(s.publicId ?? ''),
    )
    expect(
      bad.slice(0, 5).map((s) => `${s.kind} ${JSON.stringify(s.name)} (${s.id})`),
      `${port}: ${bad.length} names carry whitespace`,
    ).toEqual([])
  })

  it.each(PORTS)('%s has no duplicate publicIds', (port) => {
    const model = load(port)
    if (!model) return
    const seen = new Map<string, number>()
    for (const s of model.symbols) {
      const id = s.publicId ?? s.id
      seen.set(id, (seen.get(id) ?? 0) + 1)
    }
    const dupes = [...seen].filter(([, n]) => n > 1)
    expect(dupes.slice(0, 5), `${port}: ${dupes.length} duplicated publicIds`).toEqual([])
  })
})

describe('the resolver keeps its rate', () => {
  /**
   * A floor, not a target.
   *
   * The spike measured 76% over a hand-collected corpus; the production
   * resolver reaches higher because it gained a module step and a constructor
   * tie-break. What this guards is the direction: a change that makes
   * resolution stricter can only be justified by the wrong links it removes,
   * and this fails when one removes right ones instead.
   *
   * The corpus is deliberately written here rather than scraped from the
   * built site. Scraped, it would shrink whenever the resolver got worse —
   * fewer links found, fewer mentions to check — and the rate would hold
   * while the site lost half its links.
   */
  const CORPUS: { port: string; text: string }[] = [
    { port: 'py', text: 'Server.new_session' },
    { port: 'py', text: 'pane.capture_pane()' },
    { port: 'py', text: 'libtmux.Window' },
    { port: 'py', text: 'session.new_window()' },
    { port: 'ts', text: 'Server.newSession' },
    { port: 'ts', text: 'pane.capture()' },
    { port: 'ts', text: 'selection.Selection' },
    { port: 'rs', text: 'Server::new_session' },
    { port: 'rs', text: 'pane.capture()' },
    { port: 'rs', text: 'blocking.Runtime' },
    { port: 'go', text: 'tmux.Server.Sessions' },
    { port: 'go', text: 'server.NewSession(ctx)' },
    { port: 'go', text: 'window.Panes(ctx)' },
    { port: 'java', text: 'Server.newSession' },
    { port: 'java', text: 'pane.capture()' },
    { port: 'dotnet', text: 'Server.CreateSessionAsync' },
    { port: 'dotnet', text: 'pane.CaptureAsync()' },
    { port: 'cxx', text: 'libtmux::Pane' },
    { port: 'cxx', text: 'pane.capture()' },
    { port: 'cxx', text: 'server.new_session()' },
    { port: 'swift', text: 'Server.sessions' },
    { port: 'swift', text: 'server.newSession' },
  ]

  it('resolves at least 85% of a fixed corpus', () => {
    const models = PORTS.map(load).filter(Boolean) as ApiModel[]
    if (!models.length) return
    const resolver = new Resolver(models)

    const attempted = CORPUS.filter((c) => !notASymbol(c.text))
    const failures: string[] = []
    for (const { port, text } of attempted) {
      const res = resolver.resolve(port, text)
      if (res.how === 'ambiguous' || res.how === 'no-symbol' || res.how === 'not-a-symbol') {
        failures.push(`${port}: ${text} (${res.how})`)
      }
    }
    const rate = 1 - failures.length / attempted.length
    expect(rate, `${failures.length}/${attempted.length} unresolved:\n${failures.join('\n')}`)
      .toBeGreaterThanOrEqual(0.85)
  })

  it('still refuses what it should refuse', () => {
    const models = PORTS.map(load).filter(Boolean) as ApiModel[]
    if (!models.length) return
    const resolver = new Resolver(models)
    // A rate floor alone is satisfied by resolving everything to anything.
    for (const text of ['pane.py', '--socket-name', 'x == y', '...rest']) {
      expect(notASymbol(text), `${text} should be rejected before resolution`).toBeTruthy()
    }
    expect(resolver.resolve('py', 'CompletelyMadeUpName').how).toBe('no-symbol')
  })
})

describe('doc comments give up their examples', () => {
  /**
   * Five of the eight ports write Markdown in their doc comments, and the
   * spec extractor was splitting it on the first blank line: summary, then
   * everything else as one string. 434 fenced blocks in libtmux-rs reached
   * the reference as literal ``` fences inside a paragraph, and nothing
   * carried them to the renderer that knows how to draw an example.
   *
   * Asserted against the extracted models rather than the parser, because
   * the parser was never the thing that was wrong — it did not exist.
   */
  it.each([
    ['rs', 'rust'],
    ['ts', 'ts'],
    ['py', 'python'],
  ])('%s extracts examples, tagged %s', (port, lang) => {
    const model = load(port)
    if (!model) return
    const blocks = model.symbols.flatMap((s) => s.doc?.examples ?? [])
    expect(blocks.length, `${port} extracted no examples`).toBeGreaterThan(50)
    // A bare fence in a Rust doc comment is Rust, and `no_run` is a doctest
    // attribute rather than a language — a renderer asked to highlight
    // `compile_fail` highlights nothing.
    const wrong = blocks.filter((b) => b.lang !== lang)
    expect(wrong.slice(0, 3).map((b) => b.lang), `${port} mis-tagged blocks`).toEqual([])
  })

  it.each(['rs', 'ts', 'py'])('%s leaves no fence behind in a body', (port) => {
    const model = load(port)
    if (!model) return
    const stray = model.symbols.filter((s) => (s.doc?.body ?? '').includes('```'))
    expect(
      stray.slice(0, 3).map((s) => s.publicId ?? s.id),
      `${port}: bodies still carrying a code fence`,
    ).toEqual([])
  })
})

describe('each language gets its own spelling of a cross-reference', () => {
  /**
   * Block parsing has always dispatched per language; inline parsing did not.
   * One reST-shaped tokenizer served all eight, so Go's `[Name]`, javadoc's
   * `{@link}`, C#'s `<see cref>` and DocC's ``Symbol`` all reached the page as
   * literal text. Measured over the built reference: Python 8.3 links per
   * thousand characters of description, Go and Java and .NET exactly 0.
   *
   * The Rust matcher is why Go's went unnoticed. It requires `::` so that
   * `[see below]` is not read as a reference — and Go separates with a dot,
   * so the same guard excluded all 2,021 of its links.
   */
  const ref = (spans: ReturnType<typeof tokenizeDoc>) =>
    spans.filter((s) => s.kind === 'ref').map((s) => (s as { target: string }).target)

  it('Go doc links resolve, Rust-style ones do not leak into Go', () => {
    expect(ref(tokenizeDoc('See [GlobalWindowScope.Options] for this.', 'go'))).toEqual([
      'GlobalWindowScope.Options',
    ])
    // Bracketed prose is not a reference, and a Markdown link is not one either.
    expect(ref(tokenizeDoc('as noted [see below] and [text](http://x)', 'go'))).toEqual([])
  })

  it('Rust keeps its scope operator, and Go links do not fire there', () => {
    expect(ref(tokenizeDoc('Returns [`Error::Unsupported`] below 3.3.', 'rs'))).toEqual([
      'Error.Unsupported',
    ])
    expect(ref(tokenizeDoc('the [Options] field', 'rs'))).toEqual([])
  })

  it('javadoc and TSDoc inline tags', () => {
    expect(ref(tokenizeDoc('Use {@link Server#newSession} instead.', 'java'))).toEqual([
      'Server.newSession',
    ])
    // `{@code x}` is a literal, the same thing reST spells with double backticks.
    const spans = tokenizeDoc('Pass {@code null} to clear.', 'java')
    expect(spans.filter((s) => s.kind === 'code').map((s) => (s as { text: string }).text)).toEqual([
      'null',
    ])
  })

  it('rustdoc links to an item in scope, and through Markdown syntax', () => {
    // The `::` guard that keeps `[see below]` from being a reference also
    // excluded every link to an item already in scope. Backticks disambiguate.
    expect(ref(tokenizeDoc('Unlike [`Window`], a pane is one thing.', 'rs'))).toEqual(['Window'])
    // rustdoc accepts an item path where Markdown expects a URL.
    expect(ref(tokenizeDoc('Unlike [`Window`](crate::Window), it is.', 'rs'))).toEqual(['Window'])
    expect(ref(tokenizeDoc('See [`run`](Self::run) first.', 'rs'))).toEqual(['.run'])
    // A real URL and a relative path are still Markdown links.
    expect(ref(tokenizeDoc('see [design](../docs/design.md) and [x](http://a)', 'rs'))).toEqual([])
  })

  it('C# see-cref, with the addressing prefix removed', () => {
    expect(ref(tokenizeDoc('See <see cref="T:LibTmux.Server"/> for more.', 'dotnet'))).toEqual([
      'LibTmux.Server',
    ])
  })

  it('a C# keyword is a literal, not a member', () => {
    const spans = tokenizeDoc('Or <see langword="null" /> for the default.', 'dotnet')
    expect(spans.filter((s) => s.kind === 'code').map((s) => (s as { text: string }).text)).toEqual([
      'null',
    ])
  })

  it('a summary reaches metadata as prose, not markup', () => {
    expect(docSummaryText('Typed fields of {@link Pane}.', 'java')).toBe('Typed fields of Pane.')
    expect(docSummaryText('Call ``Server/kill()`` first.', 'swift')).toBe('Call Server/kill() first.')
  })

  it('DocC gives double backticks the meaning reST gives single ones', () => {
    // ``Server`` is a symbol link in a Swift doc comment and a literal in reST.
    expect(ref(tokenizeDoc('Call ``Server/kill()`` first.', 'swift'))).toEqual(['Server/kill'])
    const asRest = tokenizeDoc('Call ``Server`` first.', 'py')
    expect(asRest.some((s) => s.kind === 'code')).toBe(true)
  })

  it('an undeclared language still gets reST, which the Python corpus needs', () => {
    expect(ref(tokenizeDoc('See :meth:`Pane.send_keys` now.'))).toEqual(['Pane.send_keys'])
  })
})

describe('a doc comment is read in the dialect it was written in', () => {
  /**
   * Javadoc is HTML by specification, and reading it as prose printed 192
   * `<p>` and 7 `<pre>` across 146 pages of the Java reference — the same
   * failure C# XML had before `parseXmlDoc`.
   *
   * The hard part is that a doc comment also contains `List<String>` and
   * `<socket>`. Only javadoc's own vocabulary may be translated.
   */
  it('javadoc HTML becomes the model, and other angle brackets survive', () => {
    const md = javadocToMarkdown(
      'Takes a {@code List<String>} at a <socket> path.\n\n<p>Then <em>waits</em>.',
    )
    expect(md).toContain('List<String>')
    expect(md).toContain('<socket>')
    expect(md).not.toContain('<p>')
    expect(md).toContain('*waits*')
  })

  it('javadoc example blocks reach the renderer that draws examples', () => {
    const { doc } = parseJavadoc('Creates it.\n\n<pre>{@code\nvar s = server.newSession();\n}</pre>')
    expect(doc.examples?.map((e) => [e.lang, e.code])).toEqual([
      ['java', 'var s = server.newSession();'],
    ])
  })
})

describe('doc comments give up their parameters', () => {
  /**
   * C# was the only language whose compiler already produces a structured doc
   * model, and it was the only one rendering that structure as visible
   * markup: 2,034 XML tags escaped onto the page. Java writes 183 `@param`
   * and none of them reached a field list.
   */
  it.each([
    ['dotnet', 900],
    ['java', 40],
    ['py', 500],
  ])('%s documents at least %i parameters', (port, floor) => {
    const model = load(port)
    if (!model) return
    const documented = model.symbols
      .flatMap((s) => s.signatures)
      .flatMap((sig) => sig.params)
      .filter((p) => p.doc).length
    expect(documented).toBeGreaterThanOrEqual(floor)
  })

  it('no C# doc XML survives into a rendered description', () => {
    const model = load('dotnet')
    if (!model) return
    const leaked = model.symbols.filter((s) =>
      /<(summary|remarks|para|returns|example|list)\b/.test(
        `${s.doc?.summary ?? ''}${s.doc?.body ?? ''}`,
      ),
    )
    expect(leaked.slice(0, 3).map((s) => s.publicId ?? s.id)).toEqual([])
  })
})

describe('every member has an owner that exists', () => {
  /**
   * A member whose declared parent is not in the model renders nowhere: the
   * page shows entries for types it has, and this belongs to one it does not.
   * The symbol index still linked all 22 of them, so they surfaced as broken
   * anchors rather than as missing content — which is the only reason they
   * were noticed at all.
   *
   * Two causes and two answers. Go's exported method on an unexported type is
   * not public API and is dropped; Swift's extension on `Sequence` is public
   * API on a foreign type and is re-parented to the top level.
   */
  it.each(['py', 'ts', 'rs', 'go', 'java', 'dotnet', 'cxx', 'swift'])(
    '%s has no member pointing at a missing owner',
    (port) => {
      const model = load(port)
      if (!model) return
      const present = new Set(model.symbols.map((s) => s.id))
      const orphans = model.symbols.filter((s) => s.parent && !present.has(s.parent))
      expect(
        orphans.slice(0, 3).map((s) => `${s.publicId ?? s.id} -> ${s.parent}`),
        `${port}: ${orphans.length} members whose owner is not in the model`,
      ).toEqual([])
    },
  )

  it('keeps an extension on a foreign type, at the top level', () => {
    const model = load('swift')
    if (!model) return
    // `Sequence.exactlyOne(_:)` is this library's method on somebody else's
    // protocol. Dropping it with Go's private receivers would lose real API.
    const ext = model.symbols.find((s) => (s.publicId ?? s.id).startsWith('Sequence.exactlyOne'))
    expect(ext, 'Sequence.exactlyOne should survive').toBeDefined()
    expect(ext?.parent, 'and should have no owner to hang from').toBeUndefined()
  })
})

describe('the mention index is computed, not observed', () => {
  /**
   * `tableMentions` is what both the generator and `rehype-api-links` decide
   * with, so the backlink on a symbol page and the forward link in the prose
   * agree by construction rather than by two heuristics staying in step.
   */
  const LABELS = { Python: 'py', Go: 'go', 'C++': 'cxx' }

  it('reads a port-labelled table row', () => {
    const md = [
      '| Port | Sessions |',
      '|------|----------|',
      '| Python | `server.sessions` |',
      '| Go | `server.Sessions(ctx)` |',
    ].join('\n')
    expect(tableMentions(md, LABELS)).toEqual([
      { port: 'py', text: 'server.sessions', line: 3 },
      { port: 'go', text: 'server.Sessions(ctx)', line: 4 },
    ])
  })

  it('ignores a row whose first cell is not a port', () => {
    const md = '| Note | `server.sessions` |'
    expect(tableMentions(md, LABELS)).toEqual([])
  })

  it('ignores prose that is not a code span, and code that is not a name', () => {
    const md = [
      '| Python | server.sessions |',
      '| Go | `see the guide` |',
      '| C++ | `-L socket-name` |',
    ].join('\n')
    // Unbackticked prose is not a mention, and neither is a phrase with
    // spaces and no call parens — which covers both the sentence and the
    // command-line flag, so the resolver is never asked about either.
    expect(tableMentions(md, LABELS)).toEqual([])
  })

  it('does not split a pipe inside a code span into two columns', () => {
    // The pipe in `str | None` is content. Split on it, the row gains a column
    // and every cell after it shifts — including, in a row whose first cell is
    // the port, the one the port label is read from. What this asserts is that
    // the later cell is still found, not that the annotation is a mention:
    // `str | None` has spaces and no call parens, so the heuristic rejects it
    // and the resolver is never asked, which is correct.
    const md = '| Python | `str | None` | `server.sessions` |'
    expect(tableMentions(md, LABELS).map((m) => m.text)).toEqual(['server.sessions'])
  })
})
