#!/usr/bin/env node
/** Exercise the showcase generator against sources that must be refused. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { assertPinNeeded, assertVia, hasRevision, parseConfig, quoteDocument, readExample, supportTable, testedStatus, trustedBlock, validateSupport } from './gen-workspace-showcase.mjs'
import { VIA } from './lib/workspace-showcase-sources.mjs'

const here = dirname(fileURLToPath(import.meta.url))

const DOCUMENT = 'session_name: demo\nwindows:\n  - window_name: one\n    panes: [echo a, echo b]\n'

// Dedenting, markers and anchors.
const source = ['const a = `unrelated`', 'fn demo() {', '  doc := `session_name: demo', 'windows:', '- panes: [x]', '`', '}'].join('\n')
assert.deepEqual(quoteDocument(source, { open: 'doc := `', close: '`', after: 'fn demo' }), { text: 'session_name: demo\nwindows:\n- panes: [x]', lines: [3, 5] })
const indented = '    """\n    a: 1\n      b: 2\n    """'
assert.equal(quoteDocument(indented, { open: '"""\n', close: '\n    """' }).text, 'a: 1\n  b: 2')
assert.throws(() => quoteDocument(source, { open: 'doc := `', close: '`', after: 'fn missing' }), /anchor not found/)
assert.throws(() => quoteDocument(source, { open: 'nothing := `', close: '`' }), /opening marker not found/)
assert.throws(() => quoteDocument(source, { open: 'doc := `', close: '#' }), /closing marker not found/)
assert.throws(() => quoteDocument('x := ``', { open: 'x := `', close: '`' }), /empty/)
console.log('ok   quoted documents are dedented, anchored and refused when a marker is missing')

assert.deepEqual(parseConfig('a: [1, 2]\nb: {c: d}'), { a: [1, 2], b: { c: 'd' } })
assert.throws(() => parseConfig('- just\n- a list'), /mapping/)
assert.throws(() => parseConfig('a: [unterminated'))
console.log('ok   a workspace document must be a mapping that parses')

// A pinned revision stands in for the API model's only while the model records the revision it was chosen against.
const OLDER = '46cccfef2a546de55ce8b308249b8c76339089a0'
const NEWER = 'afd56d4dfa441b5bab9d9996ebd5b303fc5c4a3a'
const LATER = '0123456789abcdef0123456789abcdef01234567'
assert.doesNotThrow(() => assertPinNeeded('ts', { pin: NEWER, generatedAgainst: OLDER }, OLDER))
assert.throws(() => assertPinNeeded('ts', { pin: NEWER, generatedAgainst: OLDER }, NEWER), /equals the API model's revision/)
assert.throws(() => assertPinNeeded('ts', { pin: OLDER, generatedAgainst: NEWER }, NEWER, (older, newer) => older === OLDER && newer === NEWER), /older than the API model's/)
assert.throws(() => assertPinNeeded('ts', { pin: NEWER }, OLDER), /needs the model revision it was chosen against/)
// The model moving past the pin, or to some revision the pin was not chosen against, refuses it with no checkout to ask.
assert.throws(() => assertPinNeeded('ts', { pin: NEWER, generatedAgainst: OLDER }, LATER), /the API model moved from 46cccfef.* to 0123456789abcdef.* since SOURCES.ts.revision was chosen/)
assert.throws(() => assertPinNeeded('ts', { pin: NEWER, generatedAgainst: OLDER }, NEWER.replace('a', 'b')), /moved from/)
console.log('ok   a pin is refused once the API model records another revision than the one it was chosen against')

// Revisions, tests and fixtures in a repository of their own.
const scratch = mkdtempSync(join(tmpdir(), 'libtmux-workspace-showcase-'))
const git = (...args) => execFileSync('git', ['-C', scratch, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim()
try {
  git('init', '--quiet')
  mkdirSync(join(scratch, 'fixtures'))
  writeFileSync(join(scratch, 'fixtures/demo.yaml'), DOCUMENT)
  writeFileSync(join(scratch, 'loads_test.py'), [
    'def test_demo():', '    load("fixtures/demo.yaml")', '', 'DOCUMENT = """', 'session_name: quoted', 'windows:', '  - panes: [echo a]', '"""', '',
  ].join('\n'))
  git('add', '.')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Fixture')
  const revision = git('rev-parse', 'HEAD')
  const example = {
    topic: 'two-pane', also: [], source: { path: 'fixtures/demo.yaml' },
    tests: [{ path: 'loads_test.py', name: 'test_demo', via: 'cli', checks: 'Loads the file.' }],
  }
  const read = (change = {}, tmuxp) => readExample({ checkout: scratch, revision, example: { ...example, ...change }, tmuxp })

  const good = read()
  assert.equal(good.yaml, DOCUMENT.trimEnd())
  assert.deepEqual(JSON.parse(good.json).windows[0].panes, ['echo a', 'echo b'])
  assert.equal(good.tests[0].line, 1)
  assert.equal(hasRevision({ checkout: scratch, revision }), true)
  assert.equal(hasRevision({ checkout: scratch, revision: 'a'.repeat(40) }), false)
  assert.equal(hasRevision({ checkout: join(scratch, 'absent'), revision }), false)
  console.log('ok   an example is read from committed bytes with the line of its test')

  // A later commit and a dirty tree do not change the bytes read at the revision.
  writeFileSync(join(scratch, 'fixtures/demo.yaml'), 'session_name: changed\nwindows: []\n')
  assert.deepEqual(read(), good)
  console.log('ok   a dirty working tree does not change an example')

  assert.throws(() => read({ tests: [{ ...example.tests[0], name: 'test_renamed' }] }), /"test_renamed" is not in the file/)
  assert.throws(() => read({ tests: [{ ...example.tests[0], needles: ['other.yaml'] }] }), /"other.yaml" is not in the file/)
  assert.throws(() => read({ tests: [{ ...example.tests[0], path: 'missing_test.py' }] }))
  assert.throws(() => read({ source: { path: 'fixtures/missing.yaml' } }))
  console.log('ok   a test that is renamed, no longer names its fixture or is absent fails')

  // How a test reaches its file is a value the page can describe.
  for (const via of VIA) assert.doesNotThrow(() => read({ tests: [{ ...example.tests[0], via }] }), via)
  assert.ok(VIA.includes('scheduled'))
  assert.throws(() => read({ tests: [{ ...example.tests[0], via: 'carrier-pigeon' }] }), /via "carrier-pigeon" is none of/)
  assert.throws(() => read({ tests: [{ ...example.tests[0], via: undefined }] }), /is none of/)
  assert.throws(() => assertVia('fixture', { via: 'CLI' }), /is none of/)
  console.log('ok   a test must reach its file by a listed route, scheduled runs included')

  // A file that is byte-identical to a tmuxp example says so, and only then.
  const digest = (text) => createHash('sha256').update(text).digest('hex')
  const twin = read({}, { '2-pane-vertical': digest(DOCUMENT.trimEnd()), '3-pane': digest('other') })
  assert.equal(twin.tmuxp, '2-pane-vertical')
  assert.equal(read({}, { '3-pane': digest('other') }).tmuxp, undefined)
  assert.equal(good.tmuxp, undefined)
  console.log('ok   an example is marked identical to a tmuxp example only by its bytes')

  // What a port supports: names must be tmuxp's, and an unsupported preset cannot be shown.
  assert.doesNotThrow(() => validateSupport('fixture', { unsupported: { sleep: { reason: 'refused' } }, caveats: { options: { reason: 'differs' } }, libraryOnly: ['3-pane'] }, [twin]))
  assert.throws(() => validateSupport('fixture', { caveats: { 'not-an-example': { reason: 'x' } } }, []), /not one of tmuxp's examples/)
  assert.throws(() => validateSupport('fixture', { unsupported: { '2-pane-vertical': { reason: 'refused' } } }, [twin]), /does not support: refused/)
  assert.throws(() => validateSupport('fixture', { libraryOnly: ['2-pane-vertical'] }, [twin]), /cannot be library-only/)
  assert.equal(testedStatus('2-pane-vertical', [twin]), 'identical')
  assert.equal(testedStatus('2-pane-vertical', [good]), 'other')
  assert.equal(testedStatus('3-pane', [good], ['3-pane']), 'library-only')
  assert.equal(testedStatus('sleep', [good]), 'missing')
  console.log('ok   a preset the port does not support cannot be shown, and a status follows the tests')

  // The cache stands in for a checkout only when it still describes the sources.
  const support = {
    unsupported: { 'plugin-system': { reason: 'refused', cite: { path: 'loader.py', find: 'plugins' } } },
    caveats: { options: { reason: 'differs' } },
    defaultLayout: { layout: 'tiled', cite: { path: 'README.md', find: 'tiled' } },
  }
  const table = supportTable('fixture', {}, support, [good], (entry) => ({ ...entry, line: 3 }))
  const block = { repo: 'fixture/repo', revision, support: table, examples: [good] }
  const wanted = { repo: 'fixture/repo', revision, examples: [example], support }
  const digests = { '2-pane-vertical': 'unrelated', sleep: 'other' }
  assert.equal(table.presets['plugin-system'].supported, 'no')
  assert.equal(table.presets.options.supported, 'caveat')
  assert.equal(table.presets['3-pane'].supported, 'yes')
  assert.equal(trustedBlock(block, wanted, digests), true)
  assert.equal(trustedBlock(undefined, wanted, digests), false)
  assert.equal(trustedBlock({ ...block, revision: 'b'.repeat(40) }, wanted, digests), false)
  assert.equal(trustedBlock({ ...block, repo: 'another/repo' }, wanted, digests), false)
  assert.equal(trustedBlock({ ...block, examples: [{ ...good, yaml: 'damaged: true' }] }, wanted, digests), false)
  assert.equal(trustedBlock(block, { ...wanted, examples: [{ ...example, topic: 'tiled' }] }, digests), false)
  assert.equal(trustedBlock(block, { ...wanted, examples: [{ ...example, source: { path: 'fixtures/other.yaml' } }] }, digests), false)
  assert.equal(trustedBlock(block, { ...wanted, examples: [{ ...example, tests: [{ ...example.tests[0], name: 'test_other' }] }] }, digests), false)
  assert.equal(trustedBlock(block, { ...wanted, examples: [] }, digests), false)
  // The evidence text is part of what the cache must still describe.
  const withTest = (change) => ({ ...block, examples: [{ ...good, tests: [{ ...good.tests[0], ...change }] }] })
  assert.equal(trustedBlock(withTest({}), wanted, digests), true)
  assert.equal(trustedBlock(withTest({ via: 'loader' }), wanted, digests), false)
  assert.equal(trustedBlock(withTest({ via: 'scheduled' }), wanted, digests), false)
  assert.equal(trustedBlock(withTest({ checks: 'Loads the file and checks nothing else.' }), wanted, digests), false)
  assert.equal(trustedBlock(withTest({ checks: `${good.tests[0].checks} ` }), wanted, digests), false)
  assert.equal(trustedBlock({ ...block, examples: [{ ...good, note: 'Added by hand.' }] }, wanted, digests), false)
  assert.equal(trustedBlock(block, { ...wanted, examples: [{ ...example, note: 'A note the cache lacks.' }] }, digests), false)
  assert.equal(trustedBlock(block, { ...wanted, examples: [{ ...example, tests: [{ ...example.tests[0], via: 'builder' }] }] }, digests), false)
  assert.equal(trustedBlock(block, { ...wanted, examples: [{ ...example, tests: [{ ...example.tests[0], checks: 'Another claim.' }] }] }, digests), false)
  // A quoted document records its line range, which must span its own rows; a whole file records none.
  const quotedSource = { path: 'loads_test.py', extract: { open: 'DOCUMENT = """\n', close: '"""' } }
  const quotedExample = { ...example, source: quotedSource, tests: [{ ...example.tests[0], path: 'loads_test.py', needles: ['DOCUMENT'] }] }
  const quoted = read({ source: quotedSource, tests: quotedExample.tests })
  assert.deepEqual(quoted.source.lines, [5, 7])
  assert.equal(trustedBlock({ ...block, examples: [quoted] }, { ...wanted, examples: [quotedExample] }, digests), true)
  assert.equal(trustedBlock({ ...block, examples: [{ ...quoted, source: { ...quoted.source, lines: [5, 8] } }] }, { ...wanted, examples: [quotedExample] }, digests), false)
  assert.equal(trustedBlock({ ...block, examples: [{ ...quoted, source: { ...quoted.source, lines: [5] } }] }, { ...wanted, examples: [quotedExample] }, digests), false)
  assert.equal(trustedBlock({ ...block, examples: [{ ...quoted, source: { path: quoted.source.path } }] }, { ...wanted, examples: [quotedExample] }, digests), false)
  assert.equal(trustedBlock({ ...block, examples: [{ ...good, source: { ...good.source, lines: [1, 1] } }] }, wanted, digests), false)
  // The support table is part of what the cache must still describe.
  assert.equal(trustedBlock(block, { ...wanted, support: { ...support, caveats: { options: { reason: 'changed' } } } }, digests), false)
  assert.equal(trustedBlock(block, { ...wanted, support: { ...support, unsupported: {} } }, digests), false)
  assert.equal(trustedBlock(block, { ...wanted, support: { ...support, defaultLayout: { layout: 'tiled', cite: { path: 'README.md', find: 'stacked' } } } }, digests), false)
  assert.equal(trustedBlock({ ...block, support: { ...table, presets: { ...table.presets, 'plugin-system': { ...table.presets['plugin-system'], supported: 'yes' } } } }, wanted, digests), false)
  // An identical claim must match tmuxp's committed digest of the example.
  assert.equal(trustedBlock({ ...block, examples: [twin] }, wanted, { '2-pane-vertical': twin.sha256 }), true)
  assert.equal(trustedBlock({ ...block, examples: [twin] }, wanted, { '2-pane-vertical': 'changed' }), false)
  assert.equal(trustedBlock(block, wanted, { 'other-name': good.sha256 }), false)
  console.log('ok   a cached block is refused after a pin, a topic, a source, a test, a support claim or its bytes change')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

// The generator itself, on copies of the committed data, with no checkout reachable: an empty HOME hides
// every `~/` checkout and the override variables are dropped, so `--check` has only the cache to trust.
const COMMITTED = join(here, '../site/src/data/workspace-showcase.json')
const sandbox = mkdtempSync(join(tmpdir(), 'libtmux-workspace-showcase-copy-'))
try {
  const home = join(sandbox, 'home')
  mkdirSync(home)
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('LIBTMUX_DOCS_CHECKOUT_')))
  env.HOME = home
  const committed = JSON.parse(readFileSync(COMMITTED, 'utf8'))
  let copies = 0
  /** Run `--check` on a copy of the committed data after `change` edits it. */
  const checkCopy = (change) => {
    const data = structuredClone(committed)
    change(data)
    const file = join(sandbox, `data-${copies++}.json`)
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
    try {
      const stdout = execFileSync(process.execPath, [join(here, 'gen-workspace-showcase.mjs'), '--check', '--data', file], { env, encoding: 'utf8', stdio: 'pipe' })
      return { ok: true, output: stdout }
    } catch (error) {
      return { ok: false, output: `${error.stdout}${error.stderr}` }
    }
  }
  /** The first port's example and test that satisfy `wanted`. */
  const first = (data, port, wanted) => {
    const example = data.ports[port].examples.find((candidate) => candidate.tests.some(wanted))
    return { example, test: example.tests.find(wanted) }
  }

  const untouched = checkCopy(() => {})
  assert.equal(untouched.ok, true, untouched.output)
  assert.match(untouched.output, /verified from the cache; checkouts unavailable/)
  console.log('ok   the unmodified data passes --check from the cache alone')

  // Each edit must be refused because the cache no longer describes the sources, not for any other reason.
  const refused = (port, change) => {
    const result = checkCopy(change)
    assert.equal(result.ok, false, `${port}: the edit was accepted`)
    assert.match(result.output, new RegExp(`${port}: no verified cache for `), result.output)
  }
  refused('go', (data) => { first(data, 'go', (test) => test.via === 'cli').test.via = 'loader' })
  refused('rs', (data) => { first(data, 'rs', (test) => test.via === 'scheduled').test.via = 'cli' })
  console.log('ok   a hand-edited via is refused')
  refused('py', (data) => { data.ports.py.examples[0].tests[0].checks += ' Hand edited.' })
  refused('rs', (data) => { first(data, 'rs', (test) => test.via === 'scheduled').test.checks = 'Runs on every pull request.' })
  console.log('ok   hand-edited checks text is refused')
  // The JSON tab is converted from the YAML, so a JSON that is not what the YAML converts to is refused.
  refused('go', (data) => { data.ports.go.examples[0].json = data.ports.go.examples[0].json.replace(/"(\w+)":/, '"$1_edited":') })
  refused('py', (data) => { data.ports.py.examples[0].json = JSON.stringify({ not: 'the yaml' }, null, 2) })
  refused('rs', (data) => { data.ports.rs.examples[0].json = JSON.stringify(JSON.parse(data.ports.rs.examples[0].json)) })
  console.log('ok   a JSON that the YAML does not convert to is refused, whatever its shape')
  refused('julia', (data) => { data.ports.julia.examples.find((example) => example.note).note = 'Edited by hand.' })
  refused('julia', (data) => { delete data.ports.julia.examples.find((example) => example.note).note })
  refused('py', (data) => { data.ports.py.examples[0].note = 'Added by hand.' })
  console.log('ok   an edited, removed or added note is refused')
  const quotedGo = (data) => data.ports.go.examples.find((example) => example.source.lines).source
  assert.ok(quotedGo(committed).lines, 'the go example is a quoted document')
  refused('go', (data) => { const source = quotedGo(data); source.lines = [source.lines[0], source.lines[1] + 1] })
  refused('go', (data) => { delete quotedGo(data).lines })
  refused('py', (data) => { data.ports.py.examples[0].source.lines = [1, 1] })
  console.log('ok   a source line range that does not span its text, or is missing or invented, is refused')
} finally {
  rmSync(sandbox, { recursive: true, force: true })
}
