#!/usr/bin/env node
/*
 * Proof that check-example-blocks can fail, and that it passes a clean tree.
 *
 * Each case copies the real example pages, plants one defect with a text
 * replacement, and runs the real script on the copy. A replacement that
 * changes nothing aborts the case, so a page rewrite cannot turn a case into
 * a second control. The clean copy must exit 0: without it a script that
 * always failed would pass every case here.
 *
 * The revision gate (`--port`, `--checkout`, `--revision`) gets a port
 * repository of its own whose commits hold a program, the same program with
 * the line a page's `to` anchor names gone, and then no program at all. The page
 * must pass at the first commit and fail for the named reason at each later
 * one, which is how a port's trunk moves past the revision its model cites.
 *
 * The landing pages' excerpts (`site/src/data/landing-examples.json`) get the
 * same treatment: a copy of the table with one anchor broken must fail for the
 * named reason, and the same table must resolve at the revision it was
 * written against and fail at the later ones.
 */
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts/check-example-blocks.mjs')
const content = join(root, 'site/src/content/docs')
const attach = 'examples/attach-and-send-keys.md'
const capture = 'ports/go/examples/capture-pane-output.md'
const goAttach = 'ports/go/examples/attach-and-send-keys.md'
const landing = JSON.parse(readFileSync(join(root, 'site/src/data/landing-examples.json'), 'utf8'))

/** A landing table with one entry changed, for the planted-defect cases below. */
const landingWith = (owner, product, change) => ({ ...landing, [owner]: { ...landing[owner], [product]: { ...landing[owner][product], ...change } } })

const landingCases = [
  { name: 'a landing anchor that matches no line', table: landingWith('ts', 'mcp', { from: 'export async function connectAgents' }), trips: /landing page of ts, mcp: .*from anchor "export async function connectAgents" matches no line/ },
  { name: 'a landing anchor that matches several lines', table: landingWith('ts', 'workspace', { from: 'sleep 30' }), trips: /landing page of ts, workspace: .*from anchor "sleep 30" is ambiguous/ },
  { name: 'a landing range that ends inside a block', table: landingWith('go', 'mcp', { to: '=\t}' }), trips: /landing page of go, mcp: .*opens \{ it never closes/ },
  { name: 'a later landing range that matches no line', table: landingWith('java', 'workspace', { more: [{ from: 'void theDescribedSessionIsWhatGetsBuilds', to: '=    }' }] }), trips: /landing page of java, workspace: .*from anchor "void theDescribedSessionIsWhatGetsBuilds" matches no line/ },
  { name: 'a later landing range that ends inside a block', table: landingWith('java', 'workspace', { more: [{ from: 'void theDescribedSessionIsWhatGetsBuilt', to: 'assertEquals("built"' }] }), trips: /landing page of java, workspace: .*opens \{ it never closes/ },
  { name: 'a landing file missing from the example cache', table: landingWith('rs', 'mcp', { file: 'crates/tmux-mcp/examples/gone.rs' }), trips: /landing page of rs, mcp: crates\/tmux-mcp\/examples\/gone\.rs is not in the example cache/ },
]

const cases = [
  { name: 'a hand-typed shell block', page: attach, find: '## The complete script', replace: '```sh\ntmux kill-server\n```\n\n## The complete script', trips: /hand-typed block/ },
  { name: 'a hand-typed output block', page: attach, find: 'The output is `native input ready`.', replace: 'The output is:\n\n```text\nsomething the run never printed\n```', trips: /hand-typed block/ },
  { name: 'a hand-typed Go block', page: capture, find: '```go title="main.go"', replace: '```go\npackage main\n```\n\n```go title="main.go"', trips: /hand-typed block/ },
  { name: 'a complete file edited after its run', page: attach, find: "sleep 1\n    fi\ndone", replace: "sleep 2\n    fi\ndone", trips: /bytes differ from the recorded run of send-command\.sh/ },
  { name: 'a run command the record does not hold', page: attach, find: '$ sh send-command.sh', replace: '$ sh send-command.sh --fast', trips: /not a recorded run command/ },
  { name: 'an excerpt anchor that matches no line', page: attach, find: 'from="has-session"', replace: 'from="has-sessions"', trips: /from anchor "has-sessions" matches no line/ },
  { name: 'an excerpt anchor that matches several lines', page: attach, find: 'from="has-session"', replace: 'from="tmux -S"', trips: /from anchor "tmux -S" is ambiguous/ },
  { name: 'an excerpt whose range ends inside a block', page: attach, find: 'from="found=no" to="done"', replace: 'from="found=no" to="fi"', trips: /opens do it never closes/ },
  { name: 'an excerpt that carries its own text', page: attach, find: 'from="has-session"\n```', replace: 'from="has-session"\ntmux has-session\n```', trips: /carries no text of its own/ },
  { name: 'an excerpt of a block the page does not have', page: attach, find: 'excerpt="send-command.sh" from="has-session"', replace: 'excerpt="other.sh" from="has-session"', trips: /no code block titled "other\.sh"/ },
  { name: 'a Go excerpt of a file missing from the example cache', page: goAttach, find: 'file="examples/pane-io/main.go" from="ctx, cancel', replace: 'file="examples/gone/main.go" from="ctx, cancel', trips: /examples\/gone\/main\.go is not in the go example cache/ },
  { name: 'a port page linking itself as its native version', page: goAttach, find: '](/tmux/examples/attach-and-send-keys/)', replace: '](/examples/attach-and-send-keys/)', trips: /links to the page itself/ },
  { name: 'a Go file inclusion missing from the example cache', page: goAttach, find: '```go file="examples/pane-io/main.go"\n```', replace: '```go file="examples/gone/main.go"\n```', trips: /examples\/gone\/main\.go is not in the example cache/ },
]

const scratch = mkdtempSync(join(tmpdir(), 'libtmux-example-blocks-'))
function copyOf(name) {
  const directory = join(scratch, name.replaceAll(/\W+/g, '-'))
  for (const part of ['examples', 'ports/go/examples']) {
    mkdirSync(join(directory, part), { recursive: true })
    cpSync(join(content, part), join(directory, part), { recursive: true })
  }
  return directory
}
const run = (directory) => spawnSync(process.execPath, [script, '--content', directory], { encoding: 'utf8' })

try {
  const clean = run(copyOf('clean'))
  assert.equal(clean.status, 0, `the unmodified pages must pass:\n${clean.stderr}`)
  console.log('ok   clean copy of the example pages passes')

  for (const { name, page, find, replace, trips } of cases) {
    const directory = copyOf(name)
    const file = join(directory, page)
    const before = readFileSync(file, 'utf8')
    assert.ok(before.includes(find), `${name}: the page no longer contains ${JSON.stringify(find)}; update the case`)
    writeFileSync(file, before.replace(find, replace))
    const result = run(directory)
    assert.equal(result.status, 1, `${name}: expected a failure, got ${result.status}\n${result.stdout}`)
    assert.match(result.stderr, trips, `${name}: wrong reason\n${result.stderr}`)
    assert.ok(result.stderr.includes(page.replace(/\.md$/, '')), `${name}: the failure does not name the page`)
    console.log(`ok   fails on ${name}`)
  }

  // The landing page's excerpts, in a copy of the table with one defect each.
  const tables = join(scratch, 'landing')
  mkdirSync(tables, { recursive: true })
  for (const { name, table, trips } of landingCases) {
    const file = join(tables, `${name.replaceAll(/\W+/g, '-')}.json`)
    writeFileSync(file, JSON.stringify(table))
    const result = spawnSync(process.execPath, [script, '--landing', file], { encoding: 'utf8' })
    assert.equal(result.status, 1, `${name}: expected a failure, got ${result.status}\n${result.stdout}`)
    assert.match(result.stderr, trips, `${name}: wrong reason\n${result.stderr}`)
    console.log(`ok   fails on ${name}`)
  }
  const missing = join(tables, 'missing.json')
  writeFileSync(missing, JSON.stringify(landingWith('julia', 'mcp', { missing: 'No program yet.' })))
  const gap = spawnSync(process.execPath, [script, '--landing', missing], { encoding: 'utf8' })
  assert.equal(gap.status, 0, `a product with no program yet has nothing to resolve:\n${gap.stderr}`)
  console.log('ok   a product with no program yet is not asked for an excerpt')

  // The revision gate.
  const program = (ending) => ['package main', '', 'func start() error {', '\tserver, err := tmux.NewServer(options)', '\tif err != nil {', '\t\treturn err', '\t}', ending, '}', ''].join('\n')
  const repository = join(scratch, 'port')
  mkdirSync(join(repository, 'examples/prog'), { recursive: true })
  const git = (...args) => execFileSync('git', ['-C', repository, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { encoding: 'utf8', stdio: 'pipe' }).trim()
  git('init', '--quiet')
  const commit = (message) => (git('commit', '--quiet', '--all', '--allow-empty', '-m', message), git('rev-parse', 'HEAD'))
  writeFileSync(join(repository, 'examples/prog/main.go'), program('\treturn run(ctx, server)'))
  writeFileSync(join(repository, 'examples/prog/main.rs'), 'fn main() {}\n')
  git('add', 'examples/prog')
  const written = commit('Program')
  writeFileSync(join(repository, 'examples/prog/main.go'), program('\treturn server.Run(ctx)'))
  const rewritten = commit('Rewrite the program')
  git('rm', '--quiet', 'examples/prog/main.go')
  const deleted = commit('Delete the program')

  const landingFile = join(scratch, 'revision-landing.json')
  writeFileSync(landingFile, JSON.stringify({
    go: { mcp: { file: 'examples/prog/main.go', lang: 'go', from: 'server, err := tmux.NewServer', to: 'return run(ctx, server)', ci: { workflow: '.github/workflows/tests.yml', command: 'go test' } } },
  }))

  const pages = join(scratch, 'revision-pages')
  mkdirSync(join(pages, 'ports/go/examples'), { recursive: true })
  writeFileSync(join(pages, 'ports/go/examples/page.md'), [
    '---', 'route: examples/page', '---', '',
    '```go file="examples/prog/main.go" from="server, err := tmux.NewServer" to="return run(ctx, server)"', '```', '',
    '```go file="examples/prog/main.go"', '```', '',
    '```rust file="examples/prog/main.rs" from="fn main"', '```', '',
  ].join('\n'))
  const gate = (port, revision) => spawnSync(process.execPath, [script, '--content', pages, '--landing', landingFile, '--port', port, '--checkout', repository, '--revision', revision], { encoding: 'utf8' })

  const control = gate('go', written)
  assert.equal(control.status, 0, `the page must resolve at the revision it was written against:\n${control.stderr}`)
  assert.match(control.stdout, /2 file= fences of go resolve at /)
  assert.match(control.stdout, /1 landing page excerpts of go resolve at /)
  console.log('ok   the revision gate passes a page at the revision it quotes')

  for (const { name, revision, trips } of [
    { name: 'a to anchor the revision no longer holds', revision: rewritten, trips: /examples\/prog\/main\.go: to anchor "return run\(ctx, server\)" matches no line/ },
    { name: 'a file the revision deleted', revision: deleted, trips: /examples\/prog\/main\.go is not in go at / },
    { name: 'a landing excerpt the revision no longer holds', revision: rewritten, trips: /landing page of go, mcp: examples\/prog\/main\.go: to anchor "return run\(ctx, server\)" matches no line/ },
    { name: 'a landing file the revision deleted', revision: deleted, trips: /landing page of go, mcp: examples\/prog\/main\.go is not in go at / },
  ]) {
    const result = gate('go', revision)
    assert.equal(result.status, 1, `${name}: expected a failure, got ${result.status}\n${result.stdout}`)
    assert.match(result.stderr, trips, `${name}: wrong reason\n${result.stderr}`)
    assert.ok(result.stderr.includes('ports/go/examples/page'), `${name}: the failure does not name the page`)
    assert.ok(result.stderr.includes(revision), `${name}: the failure does not name the revision`)
    console.log(`ok   the revision gate fails on ${name}`)
  }

  const other = gate('rs', rewritten)
  assert.equal(other.status, 0, `a Rust run must leave Go fences alone:\n${other.stderr}`)
  assert.match(other.stderr + other.stdout, /1 file= fences of rs/)
  assert.match(other.stdout, /0 landing page excerpts of rs resolve at /)
  console.log('ok   the revision gate reads only the named port')

  const unknown = gate('go', 'not-a-revision')
  assert.equal(unknown.status, 2, `an unknown revision must not pass:\n${unknown.stdout}`)
  assert.match(unknown.stderr, /not-a-revision is not a commit/)
  assert.equal(gate('cobol', written).status, 2, 'an unknown port must not pass')
  console.log('ok   the revision gate refuses an unknown revision or port')

  // A trailing flag with no value must not fall back to the default mode.
  for (const flag of ['--port', '--checkout', '--revision']) {
    const bare = spawnSync(process.execPath, [script, '--content', pages, flag], { encoding: 'utf8' })
    assert.equal(bare.status, 2, `a bare ${flag} must not pass:\n${bare.stdout}`)
  }
  console.log('ok   the revision gate refuses a flag without its value')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
