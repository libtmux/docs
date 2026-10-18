#!/usr/bin/env node
/*
 * Proof that check-example-blocks can fail, and that it passes a clean tree.
 *
 * Each case copies the real example pages, plants one defect with a text
 * replacement, and runs the real script on the copy. A replacement that
 * changes nothing aborts the case, so a page rewrite cannot turn a case into
 * a second control. The clean copy must exit 0: without it a script that
 * always failed would pass every case here.
 */
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts/check-example-blocks.mjs')
const content = join(root, 'site/src/content/docs')
const attach = 'examples/attach-and-send-keys.md'
const capture = 'ports/go/examples/capture-pane-output.md'
const goAttach = 'ports/go/examples/attach-and-send-keys.md'

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
  { name: 'a Go file inclusion missing from the example cache', page: goAttach, find: 'file="examples/quickstart/main.go"', replace: 'file="examples/gone/main.go"', trips: /not in the example cache/ },
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
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
