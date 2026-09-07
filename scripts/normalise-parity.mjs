#!/usr/bin/env node
// Reduce the four ports' parity ledgers to one schema for site/src/pages/parity.astro.
//
// Four self-hosted-or-not ports publish a per-symbol Python-parity ledger, and no two
// use the same shape:
//
//   ~/work/libtmux/libtmux-dotnet/docs/parity/parity-ledger.json
//     Structured JSON, 626 rows, one per Python symbol (python-public-api.json in the
//     same directory is the matching 626-symbol extraction the ledger was built
//     against — 1:1, not a superset). Each row carries a `module` field directly, an
//     `implementationStatus`/`evidenceStatus` pair (both constant across all 626 rows:
//     "implemented"/"verified" — this ledger only lists symbols that have been fully
//     triaged, not a superset that could show something untriaged), a `destinationStatus`
//     of approved (has a C# destination) / excluded (deliberately not carried, with a
//     reason and usually a replacement) / internalized (implemented but not a public
//     1:1 destination), and a `testPath` — a file, not a specific method — under the
//     .NET checkout. Scoped explicitly to *public* API surface (the file's own name):
//     it has no rows at all for Python's _internal/_vendor modules, unlike the other
//     three ledgers below. Not a coverage gap; a different, documented scope.
//
//   ~/work/libtmux/libtmux-go/PARITY.md
//   ~/work/libtmux/libtmux-go/tmux/internal/parity/manifest.json
//     Two different documents doing two different jobs. PARITY.md is prose: a
//     Python-module-to-Go-file translation map plus the rules a symbol can be mapped
//     under. The per-symbol claims live in manifest.json instead — 1588 entries, each
//     with a `source` file path (not a `module` field — derived here the same way as
//     Java/Swift below), a `status` (handwritten/generated/translation), and a `proof`
//     array of {kind, test} citing a Go test function name. PARITY.md states the
//     manifest gate "rejects... unproved entries", so every entry claims a real test —
//     this script is what actually checks that claim resolves.
//
//   ~/work/libtmux/libtmux-java/docs/parity/python-api.md
//   ~/work/libtmux/libtmux-java/docs/parity/test-map.md
//     Two generated Markdown tables, no structured data file, and both are explicit
//     that this is target inventory, not a status report. python-api.md's own header:
//     "A catalogue of Python's surface, not a record of what is implemented here. A
//     row's presence says Python has it, not that Java does." Its "contract test"
//     column cites `PythonApiParityContract#...` — a class that does not exist
//     anywhere in the checkout (checked here, not just quoted: `rg -l "class
//     PythonApiParityContract"` finds nothing). test-map.md is blunter still: "Every
//     one of the 1454 rows below is marked `planned parity`, and the
//     `PythonBehaviorParityTest` each names *does not exist*. Nothing here has been
//     ported" — also confirmed absent in the checkout. test-map.md is keyed by pytest
//     node IDs and doctest chunks, not Python symbols, so it cannot be bucketed by
//     module the way the other three ledgers can; its two port-level numbers (1454
//     rows, 2 "defect decisions" that *are* implemented) are recorded once, not
//     per-module. Those two decisions are prose (no specific test citation in the
//     ledger itself), so this script marks them "claimed" rather than upgrading them
//     on the strength of an independent search across the checkout — the same
//     mechanical rule applies to every port, not a more generous one for this one.
//
//   ~/work/libtmux/libtmux-swift/Parity/
//     Five JSON files (python-public-api.json, python-behavior-contracts.json,
//     python-format-fields.json, python-query-contracts.json, source-inputs.json)
//     that describe only the Python side: extracted surface, behavior contracts,
//     format fields, source fingerprints. python-behavior-contracts.json's
//     `swiftAdaptation` field (direct/adapted/consolidated) records a planned
//     *translation strategy*, not completion — there is no field anywhere in this
//     directory recording that Swift has implemented a given symbol. Every Swift row
//     is therefore "unknown" by construction, not by a low score.
//
// Rust, C++ and TypeScript keep parity trackers of their own too (rs: a Python
// parity-claims checker script over its own ledger; cxx: a multi-file manifest under
// tools/parity/data/; ts: baseline/current JSON snapshots under
// packages/libtmux/parity/) — a fourth, fifth and sixth shape again, out of scope for
// this pass exactly as the four above are the in-scope ones.
//
// Provenance, for every port, means the same falsifiable thing: not "the ledger says
// so" but "the citation the ledger itself gives resolves to something real in that
// port's checkout, on this machine, right now":
//   test-verified — the cited test file (.NET) or test function (Go) exists.
//   claimed       — an implementation or test is asserted, but nothing resolvable is
//                    cited (Java's two defect decisions: prose says implemented, no
//                    specific test named in the ledger).
//   unknown       — the ledger itself disclaims status, or carries no status field at
//                    all (all of Java's per-symbol rows; all of Swift).
// This is deliberately not "the test passes" — that would mean checking out and
// running eight toolchains from this script, which is its own project. It is the
// finest claim this script can verify without doing that: the evidence a ledger cites
// for its own claim is not vaporware.
//
// Module bucketing: .NET's `module` field is authoritative (used as-is). Go, Java and
// Swift have no such field, so it is derived mechanically from each source-file path
// (strip a leading "src/", strip ".py", "/" -> ".", and an "__init__" last segment
// drops to name its parent package) — the same rule for all three, so their module
// keys line up with each other and, for the files .NET's ledger also covers, with
// .NET's own field. This is a derived key, not each ledger's own concept of a module,
// and it will not always agree with how a ledger's authors would have grouped their
// own rows — flagged once here rather than re-litigated at every module row.
//
// Usage:
//   node scripts/normalise-parity.mjs [--out <path>]
//
//   --out <path>   Write the manifest there (default: site/src/data/parity.json).

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = dirname(here)

function parseArgs(argv) {
  const opts = { out: join(repoRoot, 'site', 'src', 'data', 'parity.json') }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--out') opts.out = argv[++i]
    else if (arg === '-h' || arg === '--help') opts.help = true
    else throw new Error(`unrecognised argument: ${arg}`)
  }
  return opts
}

function expandHome(p) {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p
}

/** Inverse of expandHome, for paths written into the committed JSON — never a bare
 * /home/... on disk, matching every other path in this repo. */
function tildify(absPath) {
  const home = homedir()
  return absPath.startsWith(home) ? `~${absPath.slice(home.length)}` : absPath
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** "src/libtmux/_internal/query_list.py" -> "libtmux._internal.query_list";
 * "src/libtmux/__init__.py" -> "libtmux" (an __init__ names its parent package, not
 * itself). Same rule for Go's `source`, Swift's `sourceFile`, and Java's
 * source-evidence link path, so the three line up with each other and with .NET's own
 * `module` field wherever the file is one .NET's ledger covers too. */
function deriveModule(srcPath) {
  const parts = srcPath.replace(/^src\//, '').replace(/\.py$/, '').split('/')
  if (parts.at(-1) === '__init__') parts.pop()
  return parts.join('.')
}

/** Throws on a value the caller hasn't enumerated — a confident-looking wrong matrix
 * from a silently-added ledger status is worse than this script refusing to run. */
function assertKnown(value, known, context) {
  if (!known.has(value)) {
    throw new Error(`${context}: unrecognised value ${JSON.stringify(value)} (known: ${[...known].join(', ')})`)
  }
}

/** Empty per-module/per-port rollup; mutated in place by addRow. */
function emptyTally() {
  return { total: 0, testVerified: 0, claimed: 0, unknown: 0, disposition: {} }
}

function addRow(tally, provenance, dispositionKey) {
  tally.total += 1
  tally[provenance] += 1
  if (dispositionKey) tally.disposition[dispositionKey] = (tally.disposition[dispositionKey] ?? 0) + 1
}

// ---------------------------------------------------------------------------
// .NET
// ---------------------------------------------------------------------------

function parseDotnet(checkout) {
  const ledgerPath = join(checkout, 'docs/parity/parity-ledger.json')
  if (!existsSync(ledgerPath)) return { available: false, reason: `not found: ${tildify(ledgerPath)}` }

  const ledger = readJson(ledgerPath)
  const KNOWN_IMPLEMENTATION = new Set(['implemented'])
  const KNOWN_EVIDENCE = new Set(['verified'])
  const KNOWN_DESTINATION = new Set(['approved', 'excluded', 'internalized'])

  const byModule = {}
  const portTally = emptyTally()
  for (const row of ledger.rows) {
    assertKnown(row.implementationStatus, KNOWN_IMPLEMENTATION, 'dotnet implementationStatus')
    assertKnown(row.evidenceStatus, KNOWN_EVIDENCE, 'dotnet evidenceStatus')
    assertKnown(row.destinationStatus, KNOWN_DESTINATION, 'dotnet destinationStatus')

    // The ledger's own evidenceStatus is "verified" for every row, but this script
    // checks the citation rather than taking that at its word: the cited file is a
    // whole test file, not a method (the ledger doesn't name one), so file existence
    // is the finest resolution available.
    const testFile = join(checkout, row.testPath)
    const provenance = existsSync(testFile) ? 'testVerified' : 'claimed'

    const mod = row.module
    byModule[mod] ??= emptyTally()
    addRow(byModule[mod], provenance, row.destinationStatus)
    addRow(portTally, provenance, row.destinationStatus)
  }

  return {
    available: true,
    ledgerFormat:
      'JSON entries map Python public symbols to approved C# destinations, ' +
      'exclusions with reasons, or internal implementations without a public equivalent.',
    ledgerPaths: [tildify(ledgerPath)],
    pythonRevision: ledger.sourceRevision ?? null,
    scopeNote:
      'Covers the public API extracted in python-public-api.json. ' +
      "Python's _internal and _vendor modules are outside this ledger's scope.",
    portTally,
    byModule,
  }
}

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

function goTestFunctionNames(checkout) {
  // The whole checkout, not just tmux/: proof entries cite tests in sibling modules
  // too (e.g. "tmuxq.TestExactlyOneClassifiesCardinality" lives in tmuxq/, a separate
  // Go module alongside tmux/ per go.work) — confirmed by checking, not assumed; an
  // earlier tmux/-only pass falsely "claimed" 15 entries whose test genuinely exists,
  // just in tmuxq/. One ripgrep pass over the whole checkout, not per-citation: 1588
  // entries citing a few hundred distinct functions is cheaper as a set-membership
  // check.
  const out = execFileSync(
    'rg',
    ['-o', '--no-filename', '--no-line-number', 'func (Test\\w+)', '-r', '$1', '.'],
    { cwd: checkout, encoding: 'utf8' },
  )
  return new Set(out.split('\n').filter(Boolean))
}

function parseGo(checkout) {
  const manifestPath = join(checkout, 'tmux/internal/parity/manifest.json')
  if (!existsSync(manifestPath)) return { available: false, reason: `not found: ${tildify(manifestPath)}` }

  const manifest = readJson(manifestPath)
  const KNOWN_STATUS = new Set(['handwritten', 'generated', 'translation'])
  const testFuncs = goTestFunctionNames(checkout)

  const byModule = {}
  const portTally = emptyTally()
  for (const entry of manifest.entries) {
    assertKnown(entry.status, KNOWN_STATUS, 'go entry status')

    const proofs = entry.proof ?? []
    const provenance =
      proofs.length === 0
        ? 'unknown'
        : proofs.every((p) => testFuncs.has(p.test.split('.').at(-1)))
          ? 'testVerified'
          : 'claimed'

    // translation code (e.g. "deprecated-python-omission") is the more specific
    // disposition when present; otherwise fall back to the coarser handwritten/
    // generated/translation status.
    const dispositionKey = entry.translation ?? entry.status

    const mod = deriveModule(entry.source)
    byModule[mod] ??= emptyTally()
    addRow(byModule[mod], provenance, dispositionKey)
    addRow(portTally, provenance, dispositionKey)
  }

  return {
    available: true,
    ledgerFormat:
      'JSON entries cover Python symbols and parameter branches. Each records ' +
      'a source path and test-function citations, which this site checks for existence.',
    ledgerPaths: [tildify(manifestPath), tildify(join(checkout, 'PARITY.md'))],
    // No single Python git revision is recorded anywhere in this manifest — only
    // a sha256 digest per source file (source_digests). Surfaced in
    // revisionSkew.note (built from this field, not a hardcoded sentence) rather
    // than silently left null.
    pythonRevision: null,
    pythonRevisionNote: 'records SHA-256 digests per source file, without a shared Python Git revision',
    scopeNote: null,
    portTally,
    byModule,
  }
}

// ---------------------------------------------------------------------------
// Java
// ---------------------------------------------------------------------------

/** python-api.md's table splits cleanly on a bare "|": every default-value union type
 * in the signature column already comes HTML-entity-escaped as "&#124;", verified by
 * checking every data row splits to exactly 10 fields (8 columns + the two empty
 * ends) before trusting this for all 889 rows (as of this writing — parsed and
 * reported live below, not re-hardcoded). */
function parseJavaPythonApiTable(text) {
  const lines = text.split('\n')
  const rows = []
  const unparsed = []
  for (const line of lines) {
    if (!line.startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (cells.length !== 8 || cells[0] === 'Python symbol' || cells[0].startsWith('---')) continue
    const treatment = cells[4].replace(/<[^>]*>/g, '').trim()
    const evidence = cells[7]
    const m = evidence.match(/\[(src\/[^\]:]+)/)
    if (!m) {
      unparsed.push(evidence)
      continue
    }
    rows.push({ module: deriveModule(m[1]), treatment })
  }
  return { rows, unparsed }
}

/** python-api.md's own intro states the revision it was generated from, e.g.
 * "libtmux revision [`c4a980b`](...)" — parsed rather than copied by hand, so a
 * regenerated ledger pinned to a new revision doesn't leave a stale one in prose. */
function parseJavaPythonRevision(text) {
  const m = text.match(/libtmux revision \[`([0-9a-f]+)`\]/)
  if (!m) throw new Error('java python-api.md: could not find "libtmux revision [`<hash>`]" in its intro text')
  return m[1]
}

function parseJavaTestMapCounts(path) {
  const lines = readFileSync(path, 'utf8').split('\n')
  const statusCounts = {}
  let dataRows = 0
  for (const line of lines) {
    if (!line.startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (cells.length !== 6 || cells[0] === 'Python evidence' || cells[0].startsWith('---')) continue
    dataRows += 1
    const status = cells[5]
    statusCounts[status] = (statusCounts[status] ?? 0) + 1
  }
  return { dataRows, statusCounts }
}

function parseJava(checkout) {
  const apiPath = join(checkout, 'docs/parity/python-api.md')
  const testMapPath = join(checkout, 'docs/parity/test-map.md')
  if (!existsSync(apiPath) || !existsSync(testMapPath)) {
    return { available: false, reason: `not found under ${tildify(checkout)}/docs/parity/` }
  }

  // Both classes the ledger's own "contract test" columns cite are checked against
  // the real checkout, not just quoted from the files' own disclaimers. `rg -l`
  // exits 1 (throws, for execFileSync) on no match — that's the "not found" case,
  // not a real error.
  function ripgrepFindsClass(className) {
    try {
      return execFileSync('rg', ['-l', `class ${className}`, checkout], { encoding: 'utf8' }).trim() !== ''
    } catch {
      return false
    }
  }
  const apiContractFound = ripgrepFindsClass('PythonApiParityContract')
  const behaviorContractExists = ripgrepFindsClass('PythonBehaviorParityTest')

  const apiText = readFileSync(apiPath, 'utf8')
  const { rows, unparsed } = parseJavaPythonApiTable(apiText)
  const pythonRevision = parseJavaPythonRevision(apiText)
  const KNOWN_TREATMENT = new Set(['direct translation', 'approved omission', 'consolidation', 'semantic Java adaptation'])

  const byModule = {}
  const portTally = emptyTally()
  // Every row is "unknown" by the ledger's own declared semantics (python-api.md:
  // "an entry is not an implementation claim") — confirmed empirically, not just
  // quoted: PythonApiParityContract does not exist in the checkout either
  // (apiContractFound, recorded below for the reader to check the same way).
  const provenance = 'unknown'
  for (const row of rows) {
    assertKnown(row.treatment, KNOWN_TREATMENT, 'java Java treatment')
    byModule[row.module] ??= emptyTally()
    addRow(byModule[row.module], provenance, row.treatment)
    addRow(portTally, provenance, row.treatment)
  }

  const testMap = parseJavaTestMapCounts(testMapPath)

  return {
    available: true,
    ledgerFormat:
      `python-api.md inventories ${rows.length} Python symbols; test-map.md ` +
      `inventories ${testMap.dataRows} test cases. These Markdown tables describe ` +
      'planned Java treatments and tests, rather than completed implementations.',
    ledgerPaths: [tildify(apiPath), tildify(testMapPath)],
    pythonRevision,
    scopeNote:
      'Module counts use python-api.md. test-map.md identifies pytest cases ' +
      'and doctest chunks instead of symbols, so its counts are reported separately: ' +
      `${testMap.dataRows} rows, with statuses ${JSON.stringify(testMap.statusCounts)}. ` +
      `Its ${testMap.statusCounts['deliberate Java correction'] ?? 0} ` +
      '"deliberate Java correction" rows assert implementation but cite methods ' +
      'on the missing PythonBehaviorParityTest class. They count as claimed in ' +
      'the port total only. Server.attached_sessions has two evidence entries, ' +
      'so row counts can exceed the number of distinct corrections.',
    contractClassesFound: { PythonApiParityContract: apiContractFound, PythonBehaviorParityTest: behaviorContractExists },
    unparsedSourceEvidence: unparsed,
    portTally: (() => {
      // Fold test-map.md's "deliberate Java correction" rows into the port level
      // (see scopeNote): a status label asserts an implementation, but the ledger
      // cites no resolvable test for any of them.
      const correctionRows = testMap.statusCounts['deliberate Java correction'] ?? 0
      for (let i = 0; i < correctionRows; i += 1) addRow(portTally, 'claimed', 'deliberate-java-correction')
      return portTally
    })(),
    byModule,
  }
}

// ---------------------------------------------------------------------------
// Swift
// ---------------------------------------------------------------------------

function parseSwift(checkout) {
  const apiPath = join(checkout, 'Parity/python-public-api.json')
  if (!existsSync(apiPath)) return { available: false, reason: `not found: ${tildify(apiPath)}` }

  const api = readJson(apiPath)
  const KNOWN_DISPOSITION = new Set(['direct', 'python-only'])

  const byModule = {}
  const portTally = emptyTally()
  let inheritedFieldRows = 0
  for (const entry of api.entries) {
    assertKnown(entry.disposition, KNOWN_DISPOSITION, 'swift entry disposition')
    // No field anywhere in Parity/ records Swift-side implementation status (checked
    // across all five files, not assumed from python-public-api.json alone) —
    // swiftAdaptation on the behavior-contracts file is a planned translation
    // *strategy*, not a completion claim. Every row is "unknown" by construction.
    const mod = deriveModule(entry.sourceFile)
    byModule[mod] ??= emptyTally()
    addRow(byModule[mod], 'unknown', entry.disposition)
    addRow(portTally, 'unknown', entry.disposition)
    if (entry.kind === 'inherited-dataclass-field') inheritedFieldRows += 1
  }

  return {
    available: true,
    ledgerFormat:
      'JSON inventories Python APIs, behavior, formats, queries, and source ' +
      'fingerprints. swiftAdaptation describes a planned translation strategy; ' +
      'the files record no Swift implementation status.',
    ledgerPaths: [tildify(apiPath)],
    pythonRevision: api.pythonSource?.commit?.slice(0, 7) ?? null,
    pythonRevisionDescribe: api.pythonSource?.describe ?? null,
    // libtmux.neo alone accounts for the vast majority of this: this extractor
    // records an inherited dataclass field once per subclass that inherits it,
    // where .NET/Go/Java's ledgers record the same field once at its owning
    // class. Checked, not assumed: inheritedFieldRows below is a live count, and
    // .NET/Go/Java's own libtmux.neo row counts (~190-200) cluster far below
    // Swift's for the identical Python file. A module row where Swift's count is
    // several times another port's is very likely this, not several times the
    // actual surface.
    scopeNote:
      `${inheritedFieldRows} of this ledger's ${api.entries.length} entries ` +
      'are inherited dataclass fields, counted once for each inheriting subclass, ' +
      'mostly in libtmux.neo. These repeated entries increase row counts without ' +
      'increasing the number of distinct Python symbols.',
    portTally,
    byModule,
  }
}

// ---------------------------------------------------------------------------
// Assemble
// ---------------------------------------------------------------------------

/** Built from each port's own parsed pythonRevision (and pythonRevisionDescribe /
 * pythonRevisionNote, where present) rather than a hand-written sentence, so a
 * ledger that gets re-pinned doesn't leave stale hashes sitting in prose. */
function describeRevisionSkew(ports) {
  const groups = new Map() // "hash (describe)" -> [slug, ...]
  const notes = []
  for (const [slug, port] of Object.entries(ports)) {
    if (!port.available) continue
    if (port.pythonRevision) {
      const label = port.pythonRevisionDescribe
        ? `${port.pythonRevision} (${port.pythonRevisionDescribe})`
        : port.pythonRevision
      if (!groups.has(label)) groups.set(label, [])
      groups.get(label).push(slug)
    } else {
      notes.push(port.pythonRevisionNote ? `${slug} ${port.pythonRevisionNote}` : `${slug} records no Python revision`)
    }
  }
  if (groups.size <= 1 && notes.length === 0) {
    return 'All recorded Python revisions match.'
  }
  const pinned = [...groups.entries()].map(
    ([label, slugs]) => `${slugs.join(' and ')} ${slugs.length === 1 ? 'pins' : 'pin'} ${label}`,
  )
  return (
    'Recorded baselines: ' +
    [...pinned, ...notes].join('; ') +
    '. The ledgers do not establish a shared Python baseline for comparing coverage.'
  )
}

const CHECKOUTS = {
  dotnet: expandHome('~/work/libtmux/libtmux-dotnet'),
  go: expandHome('~/work/libtmux/libtmux-go'),
  java: expandHome('~/work/libtmux/libtmux-java'),
  swift: expandHome('~/work/libtmux/libtmux-swift'),
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log('Usage: node scripts/normalise-parity.mjs [--out <path>]')
    return
  }

  const ports = {
    dotnet: parseDotnet(CHECKOUTS.dotnet),
    go: parseGo(CHECKOUTS.go),
    java: parseJava(CHECKOUTS.java),
    swift: parseSwift(CHECKOUTS.swift),
  }

  const moduleUnion = new Set()
  for (const port of Object.values(ports)) {
    if (port.available) for (const mod of Object.keys(port.byModule)) moduleUnion.add(mod)
  }

  const manifest = {
    schemaVersion: 1,
    // No generatedAt: every regen would otherwise diff on that line alone. The
    // revisions each ledger pins itself to are the meaningful "as of" markers.
    legend: {
      testVerified: 'The cited test file (.NET) or function (Go) exists. This does not mean the test was run.',
      claimed: 'The ledger asserts an implementation or test without a resolvable citation.',
      unknown: 'The ledger records no implementation status for this row.',
    },
    revisionSkew: {
      note: describeRevisionSkew(ports),
      // Derived from each port's own pythonRevision rather than repeated by hand —
      // the per-port summary table renders that same field directly, this is only
      // a convenience rollup for a consumer that wants all four without walking
      // `ports`.
      pythonRevisionByPort: Object.fromEntries(
        Object.entries(ports).map(([slug, port]) => [slug, port.available ? port.pythonRevision : null]),
      ),
    },
    moduleUnion: [...moduleUnion].sort(),
    ports,
  }

  // No sort-keys replacer: an array replacer filters *every* nesting level to that
  // one key list, which would silently drop every nested field. Determinism instead
  // comes from the script itself — object keys are inserted in a fixed order read
  // from each ledger's own file order, and moduleUnion is explicitly sorted above.
  writeFileSync(opts.out, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`wrote ${opts.out}`)
}

main()
