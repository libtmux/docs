import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { API_HOSTS, EXTERNAL_INVENTORIES, PAGE_EXCEPTIONS, addressSegments, apiHostOf, arityOf, collectApiDestinations, qualified, terminalSymbol, urlsIn } from '../../scripts/lib/api-destinations.mjs'
import { addressOf, mismatch } from '../../scripts/lib/api-addresses.mjs'
import {
  INVENTORY_SOURCES, MAX_UNVERIFIABLE_SHARE, checkApiEvidence, expectationsOf, expectedSymbols, mentions, readPage, recordProblems, sameAddress, sectionAt, slugSymbol, unprovenSymbols,
} from '../../scripts/lib/api-destination-verification.mjs'
import evidence from '../src/data/api-destination-evidence.json'

const root = new URL('../../', import.meta.url).pathname
const destinations = collectApiDestinations({ root })
const today = new Date(`${evidence.checkedAt}T12:00:00Z`)

describe('API destination evidence', () => {
  it('holds a passing record for every destination the site generates, and none for a link nothing makes', () => {
    const { problems } = checkApiEvidence(destinations, evidence, { today, root })
    expect(problems).toEqual([])
  })

  it('never records an unreadable host as passing', () => {
    for (const record of evidence.destinations as { url: string; ok: boolean; unverifiable?: string; failure?: string; detail?: string }[]) {
      if (record.unverifiable) {
        expect(record.ok, record.url).toBe(false)
        expect(record.unverifiable.length, record.url).toBeGreaterThan(8)
      } else if (!record.ok) {
        expect(record.failure, record.url).toBeTruthy()
        expect(record.detail, record.url).toBeTruthy()
      }
    }
  })

  it('requires a page that answers 200 at its own address, and a symbol for each name', () => {
    for (const record of evidence.destinations as { url: string; ok: boolean; status: number; finalUrl?: string; checkedAt: string; terminal?: { symbol: string; at: string }[] }[]) {
      expect(record.url, 'https url').toMatch(/^https:\/\//)
      expect(record.checkedAt, record.url).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      if (!record.ok) continue
      expect(record.status, record.url).toBe(200)
      expect(record.finalUrl, `${record.url} is a redirect`).toBeUndefined()
      const destination = destinations.get(record.url)
      if (!destination) continue
      expect(unprovenSymbols(destination, record), record.url).toEqual([])
    }
  })

  it('names every cached inventory, each checked against its host and still as large as its sidecar', () => {
    expect(evidence.inventories.map((record) => record.name).sort()).toEqual(Object.keys(INVENTORY_SOURCES).sort())
    for (const record of evidence.inventories) {
      expect(record.ok, record.name).toBe(true)
      expect(record.missing, record.name).toBe(0)
    }
  })

  it('lists the same inventories the reference and the prose linker attach', () => {
    for (const file of ['src/lib/api-models.ts', 'src/lib/prose-resolver.ts']) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
      for (const { baseUrl, langs } of EXTERNAL_INVENTORIES) {
        const attached = new RegExp(`baseUrl: '${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}',\\s*langs: \\[([^\\]]*)\\]`).exec(source)
          ?? new RegExp(`langs: \\[([^\\]]*)\\][^}]*baseUrl: '${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`).exec(source)
          ?? new RegExp(`baseUrl: '${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'[^}]*langs: \\[([^\\]]*)\\]`).exec(source)
        expect(attached, `${file} attaches ${baseUrl}`).not.toBeNull()
        expect([...attached![1]!.matchAll(/'(\w+)'/g)].map(([, lang]) => lang), `${file} ${baseUrl}`).toEqual(langs)
      }
    }
  })
})

describe('what the verifier reads from a page', () => {
  it('matches a symbol as a whole word, never inside another', () => {
    expect(mentions('SetAlgebra Protocol', 'Set')).toBe(false)
    expect(mentions('Set (Java SE 21 & JDK 21)', 'Set')).toBe(true)
    expect(mentions('the_iterable_protocol', 'iterable')).toBe(true)
    expect(mentions('std-fixture-tmp_path', 'tmp_path')).toBe(true)
    expect(mentions('Vector in std::vector - Rust', 'Vec')).toBe(false)
    expect(mentions('Base.sort!', 'sort')).toBe(false)
    expect(mentions('map_or', 'map')).toBe(true)
  })

  it('opens the text after a heading when the anchor wraps the heading', () => {
    const html = '<html><head><title>Annotations</title></head><body>'
      + '<div id="documenting-types"><a href="#documenting-types">link</a><h2>Documenting Types</h2></div>'
      + '<p>Recognized types: <code>nil</code>, <code>any</code>.</p><h2 id="next">Next</h2></body></html>'
    const page = readPage(html)
    expect(page.anchors.map((anchor) => anchor.id)).toEqual(['documenting-types', 'next'])
    expect(page.headings.map((heading) => heading.text)).toEqual(['Documenting Types', 'Next'])
  })

  it('joins the words a page breaks with <wbr>, as Microsoft Learn does', () => {
    expect(readPage('<h1>File<wbr>Info Class</h1>').headings[0]?.text).toBe('FileInfo Class')
  })

  it('treats a locale, a view and a trailing slash as the same address, and a moved page as another', () => {
    expect(sameAddress('https://learn.microsoft.com/dotnet/api/system.string', 'https://learn.microsoft.com/en-us/dotnet/api/system.string?view=net-10.0')).toBe(true)
    expect(sameAddress('https://example.org/a/b/', 'https://example.org/a/b')).toBe(true)
    expect(sameAddress('https://en.cppreference.com/w/cpp/container/vector', 'https://en.cppreference.com/cpp/container/vector')).toBe(false)
    expect(sameAddress('https://hexdocs.pm/elixir/Enum.html', 'https://elixir.hexdocs.pm/Enum.html')).toBe(false)
    expect(sameAddress('https://docs.junit.org/current/api/x.html', 'https://docs.junit.org/6.1.3/api/x.html')).toBe(false)
  })

  it('reads the symbol a name asks for, and the one an address names', () => {
    expect(terminalSymbol('java', 'Optional.of')).toBe('of')
    expect(terminalSymbol('java', 'java.util.concurrent.Flow.Publisher')).toBe('Publisher')
    expect(terminalSymbol('csharp', 'int')).toBe('Int32')
    expect(terminalSymbol('elixir', 'Enum.member?/2')).toBe('member?')
    expect(terminalSymbol('ts', 'ReadonlyMap')).toBe('Map')
    expect(terminalSymbol('powershell', 'Get-Member')).toBe('Get-Member')
    expect(slugSymbol('https://doc.rust-lang.org/std/vec/struct.Vec.html')).toBe('Vec')
    expect(slugSymbol('https://learn.microsoft.com/dotnet/api/system.threading.tasks.task.whenall')).toBe('whenall')
    expect(slugSymbol('https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Optional.html#of(T)')).toBe('Optional')
    expect(slugSymbol('https://kotlinlang.org/api/core/kotlin-stdlib/kotlin.time/to-kotlin-duration.html')).toBe('to-kotlin-duration')
    expect(slugSymbol('https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_commonparameters?view=powershell-7.4')).toBe('commonparameters')
  })

  it('ends a fragment\'s section at the next entry, not at the next heading', () => {
    const entries = '<h1>Built-in Functions</h1><dl><dt id="abs">abs(x)</dt><dd>Return the absolute value of an int.</dd><dt id="int">int(x)</dt><dd>Return an integer.</dd></dl><h2 id="later">Later</h2>'
    const page = readPage(`<html><head><title>Built-in Functions</title></head><body>${entries}</body></html>`)
    expect(sectionAt(page, 'abs')).toContain('absolute value of an int')
    expect(sectionAt(page, 'abs')).not.toContain('Return an integer')
    expect(sectionAt(page, 'int')).toBe('int(x) Return an integer.')
  })

  it('opens the text after a heading when the anchor is inside it, as the JLS writes it', () => {
    const page = readPage('<html><body><h3 class="title"><a name="jls-4.2.1"></a>4.2.1. Integral Types</h3><p><a name="jls-4.2.1-100"></a>The values of byte, short and int.</p><h3><a name="jls-4.2.2"></a>4.2.2. Operations</h3></body></html>')
    expect(sectionAt(page, 'jls-4.2.1')).toBe('The values of byte, short and int.')
  })

  it('reads the path an address spells, to the member its fragment names', () => {
    const path = (url: string) => addressOf(url)?.path
    expect(path('https://doc.rust-lang.org/std/io/struct.Error.html')).toEqual(['std', 'io', 'Error'])
    expect(path('https://doc.rust-lang.org/std/iter/trait.Iterator.html#method.next')).toEqual(['std', 'iter', 'Iterator', 'next'])
    expect(path('https://pkg.go.dev/errors#Join')).toEqual(['errors', 'Join'])
    expect(path('https://pkg.go.dev/github.com/modelcontextprotocol/go-sdk@v1.6.1/mcp#Transport')).toEqual(['github.com', 'modelcontextprotocol', 'go-sdk', 'mcp', 'Transport'])
    expect(path('https://docs.python.org/3/library/warnings.html#warnings.warn')).toEqual(['warnings', 'warn'])
    expect(path('https://docs.julialang.org/en/v1/base/base/#Core.String-Tuple%7BAbstractString%7D')).toEqual(['Core', 'String'])
    expect(path('https://elixir.hexdocs.pm/Enum.html#member?/2')).toEqual(['Enum', 'member?'])
    expect(addressOf('https://elixir.hexdocs.pm/Enum.html#member?/2')?.arity).toBe('2')
    expect(path('https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/Flow.Subscription.html#request(long)')?.slice(-8)).toEqual(['java', 'base', 'java', 'util', 'concurrent', 'Flow', 'Subscription', 'request'])
    expect(path('https://www.scala-lang.org/api/3.x/scala/util/Using$.html#resource-fffffb81')).toEqual(['api', '3', 'x', 'scala', 'util', 'Using', 'resource'])
    expect(path('https://learn.microsoft.com/dotnet/api/system.collections.generic.ienumerable-1')).toEqual(['system', 'collections', 'generic', 'ienumerable'])
    expect(path('https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_commonparameters?view=powershell-7.4')).toEqual(['microsoft', 'powershell', 'core', 'about', 'commonparameters'])
    // A fragment that is a heading names no entry, and a host with no symbol address has none to read.
    expect(addressOf('https://docs.python.org/3/glossary.html#term-generator')?.fragment).toBe('heading')
    expect(addressOf('https://elixir.hexdocs.pm/typespecs.html#basic-types')?.fragment).toBe('heading')
    expect(addressOf('https://en.cppreference.com/cpp/container/vector')).toBeUndefined()
    expect(addressOf('https://www.lua.org/manual/5.4/manual.html#2.1')).toBeUndefined()
  })

  it('ends a name at the address, whole: the symbol, then each package, module or type before it', () => {
    const rust = addressOf('https://doc.rust-lang.org/std/io/struct.Error.html')!
    expect(mismatch(['Error'], rust)).toBeUndefined()
    expect(mismatch(['io', 'Error'], rust)).toBeUndefined()
    expect(mismatch(['std', 'io', 'Error'], rust)).toBeUndefined()
    expect(mismatch(['std', 'fmt', 'Error'], rust)).toBe('owner')
    expect(mismatch(['Errors'], rust)).toBe('symbol')
    // An identifier is compared whole: `sort` is not `sort!`, nor `warn` the `warn_explicit` beside it.
    expect(mismatch(['Base', 'sort'], addressOf('https://docs.julialang.org/en/v1/base/sort/#Base.sort!')!)).toBe('symbol')
    expect(mismatch(['warnings', 'warn'], addressOf('https://docs.python.org/3/library/warnings.html#warnings.warn_explicit')!)).toBe('symbol')
    expect(mismatch(['os', 'path', 'join'], addressOf('https://docs.python.org/3/builtins/stdtypes.html#str.join')!)).toBe('owner')
    expect(mismatch(['System', 'Threading', 'Timer'], addressOf('https://learn.microsoft.com/dotnet/api/system.timers.timer')!)).toBe('owner')
    expect(mismatch(['System', 'Threading', 'Timer'], addressOf('https://learn.microsoft.com/dotnet/api/system.threading.timer')!)).toBeUndefined()
    expect(mismatch(['errors', 'Join'], addressOf('https://pkg.go.dev/strings#Join')!)).toBe('owner')
  })

  it('writes a name as its address would: aliases applied, the root marker and an operand count off', () => {
    expect(addressSegments('go', 'sdk.Transport')).toEqual(['mcp', 'Transport'])
    expect(addressSegments('scala', 'cats.effect.Async')).toEqual(['cats', 'effect', 'kernel', 'Async'])
    expect(addressSegments('scala', '_root_.cats.effect.IO')).toEqual(['cats', 'effect', 'IO'])
    expect(arityOf('Enum.map/2')).toBe('2')
    expect(arityOf('HTTP/2')).toBe('2')
    expect(arityOf('Enum.map')).toBeUndefined()
    expect(qualified({ imports: { t: 'typing' } } as never, 't.Generic')).toBe('typing.Generic')
    expect(qualified({} as never, 't.Generic')).toBe('t.Generic')
  })

  it('attaches a reviewed exception to one name at one exact address, and to no other', () => {
    const uses = (port: string, name: string) => [{ port, name, source: 'builtin' }]
    const at = (url: string, port: string, name: string) => expectationsOf({ url, uses: uses(port, name) })[0]?.exception
    expect(at('https://en.cppreference.com/cpp/chrono/duration', 'cxx', 'std::chrono::milliseconds')?.tier).toBe('listed')
    expect(at('https://en.cppreference.com/cpp/chrono/steady_clock', 'cxx', 'std::chrono::milliseconds')).toBeUndefined()
    expect(at('https://en.cppreference.com/cpp/chrono/duration', 'cxx', 'std::chrono::hours')).toBeUndefined()
    expect(at('https://en.cppreference.com/cpp/container/vector', 'cxx', 'bool')).toBeUndefined()
    expect(at('https://www.lua.org/manual/5.4/manual.html#2.1', 'lua', 'nil')?.tier).toBe('section')
    expect(at('https://www.lua.org/manual/5.4/manual.html#2.2', 'lua', 'nil')).toBeUndefined()
    expect(at('https://docs.oracle.com/javase/specs/jls/se21/html/jls-4.html#jls-4.2.5', 'java', 'boolean')?.tier).toBe('section')
    expect(at('https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.9', 'java', 'boolean')).toBeUndefined()
    expect(at('https://elixir.hexdocs.pm/typespecs.html#basic-types', 'elixir', 'atom')?.tier).toBe('section')
    expect(at('https://elixir.hexdocs.pm/typespecs.html#literals', 'elixir', 'atom')).toBeUndefined()
    expect(at('https://docs.python.org/3/builtins/functions.html#abs', 'py', 'int')).toBeUndefined()
    // Every exception names an address with a fragment or a page of its own, a reason, and at least one name.
    for (const entry of PAGE_EXCEPTIONS as unknown as { tier: string; url: string; names: string[]; reason: string }[]) {
      expect(['listed', 'section'], entry.url).toContain(entry.tier)
      expect(entry.reason.length, entry.url).toBeGreaterThan(20)
      expect(entry.names.length, entry.url).toBeGreaterThan(0)
      expect(entry.url, 'an address, not a prefix').not.toMatch(/[#/]$/)
    }
  })

  it('names the contradictions in a record, and what the evidence may leave open', () => {
    const passing = { url: 'https://docs.python.org/3/builtins/functions.html#int', host: 'docs.python.org', ok: true, status: 200, via: 'html', terminal: [{ symbol: 'int', at: 'fragment' }] }
    expect(recordProblems(passing)).toEqual([])
    expect(recordProblems({ ...passing, status: 404 })[0]).toMatch(/passing with the status 404/)
    expect(recordProblems({ ...passing, failure: 'fragment' })[0]).toMatch(/passing yet carries failure/)
    expect(recordProblems({ ...passing, finalUrl: 'https://example.org/' })[0]).toMatch(/passing yet carries finalUrl/)
    expect(recordProblems({ ...passing, host: 'example.org' })[0]).toMatch(/recorded under the host/)
    expect(recordProblems({ ...passing, via: undefined })[0]).toMatch(/without saying how the host was read/)
    expect(recordProblems({ ...passing, terminal: [{ symbol: 'int', at: 'heading' }] })[0]).toMatch(/never reports/)
    expect(recordProblems({ ...passing, ok: false })[0]).toMatch(/neither passes nor says why/)
    expect(recordProblems({ ...passing, ok: false, unverifiable: 'blocked' })[0]).toMatch(/without a reason/)
    expect(MAX_UNVERIFIABLE_SHARE).toBeGreaterThan(0)
    expect(MAX_UNVERIFIABLE_SHARE).toBeLessThan(0.5)
  })

  it('asks a name once per symbol and ignores names that stand for a concept', () => {
    const destination = {
      url: 'https://example.org/x', host: 'example.org',
      uses: [
        { port: 'java', name: 'Optional', source: 'type' }, { port: 'java', name: 'java.util.Optional', source: 'prose' },
        { port: 'java', name: 'finally', source: 'keyword' }, { port: '', name: 'site/src/lib/api-glossary.ts', source: 'authored' },
      ],
    }
    expect(expectedSymbols(destination)).toEqual(['Optional'])
  })

  it('finds the links a text names without the punctuation around them', () => {
    expect(urlsIn('See [x](https://docs.python.org/3/library/re.html#re.sub), or https://go.dev/ref/spec#Constants.')).toEqual([
      'https://docs.python.org/3/library/re.html#re.sub', 'https://go.dev/ref/spec#Constants',
    ])
    expect(urlsIn('https://doc.rust-lang.org/std/${page}')).toEqual([])
  })

  it('knows which hosts document a language or an SDK', () => {
    expect(apiHostOf('https://pkg.go.dev/time#Duration')).toBe('pkg.go.dev')
    expect(apiHostOf('https://elixir.hexdocs.pm/Enum.html')).toBe('elixir.hexdocs.pm')
    expect(apiHostOf('https://github.com/libtmux/libtmux')).toBeUndefined()
    expect(API_HOSTS.has('docs.oracle.com')).toBe(true)
  })
})
