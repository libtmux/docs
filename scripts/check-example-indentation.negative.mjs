#!/usr/bin/env node
/*
 * Proof that check-example-indentation fails on flattened examples and passes
 * on the same example with its indentation intact.
 *
 * The fixture is the shape that shipped: a Java `<pre>{@code ... }</pre>`
 * whose statements are indented under a `try`, stored once with every
 * leading space removed.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { compareIndentation } from './lib/example-indentation.mjs'

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-example-indentation.mjs')
const kept = 'try (Server server = open()) {\n    Session mine = server.sessions()\n            .filter(ok)\n            .findFirst();\n}'
const flattened = kept.split('\n').map((line) => line.trimStart()).join('\n')
const comment = (lines) => `/**\n * Summary.\n *\n * <pre>{@code\n${lines.split('\n').map((line) => ` * ${line}`.trimEnd()).join('\n')}\n * }</pre>\n */\npublic class X {}\n`

assert.equal(compareIndentation(kept, comment(kept)).status, 'ok', 'an example with its indentation passes')
assert.equal(compareIndentation(flattened, comment(kept)).status, 'lost', 'a flattened example fails')
assert.equal(compareIndentation(flattened, comment(flattened)).status, 'ok', 'flat code that was written flat passes')
assert.equal(compareIndentation('$ make\n$ make test', comment(kept)).status, 'unlocated', 'code the source does not hold is not judged')
assert.equal(compareIndentation('one();', comment(kept)).status, 'single', 'one line has no relative indentation')
const rustHidden = '/// ```\n/// let a = 1;\n/// # hidden();\n///     nested();\n/// ```\n'
assert.equal(compareIndentation('let a = 1;\n    nested();', rustHidden).status, 'ok', 'a line the extractor hides is skipped')
assert.equal(compareIndentation('let a = 1;\nnested();', rustHidden).status, 'lost', 'and the lines around it still count')

/** The command line over a real git checkout and a model that records its revision. */
const root = mkdtempSync(join(tmpdir(), 'check-example-indentation-'))
try {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' }).toString().trim()
  git('init', '-q')
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src/X.java'), comment(kept))
  git('add', '.')
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'x')
  const revision = git('rev-parse', 'HEAD')
  const run = (code) => {
    const model = join(root, 'model.json')
    writeFileSync(model, JSON.stringify({ symbols: [{ id: 'X', name: 'X', kind: 'class', modifiers: [], signatures: [],
      source: { file: 'src/X.java', revision, extractedRevision: revision }, doc: { summary: 's', examples: [{ lang: 'java', code }] } }] }))
    return spawnSync(process.execPath, [script, '--port', 'java', '--model', model], {
      encoding: 'utf8', env: { ...process.env, LIBTMUX_DOCS_CHECKOUT_JAVA: root },
    })
  }
  const clean = run(kept)
  assert.equal(clean.status, 0, `the clean control passes: ${clean.stderr}`)
  const broken = run(flattened)
  assert.equal(broken.status, 1, 'a flattened example fails the check')
  assert.match(broken.stderr, /X: "Session mine = server.sessions\(\)" is 0 deep, its source comment 4/, 'and names the example and the line')
} finally {
  rmSync(root, { recursive: true, force: true })
}
console.log('check-example-indentation.negative: flattened examples fail, intact ones pass')
