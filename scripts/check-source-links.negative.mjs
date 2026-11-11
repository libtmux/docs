#!/usr/bin/env node
/*
 * Proof that check-source-links separates a commit readers can open from one
 * they cannot, when no remote-tracking branch settles it.
 *
 * Fixture repositories imitate CI (init, fetch one revision shallow, detach)
 * and a developer's unpushed commit. A local HTTP server stands in for the
 * GitHub commits API; the check reads its base from LIBTMUX_DOCS_GITHUB_API.
 *
 * Usage: node scripts/check-source-links.negative.mjs [script]
 */
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const script = resolve(process.argv[2] ?? join(here, 'check-source-links.mjs'))
const root = mkdtempSync(join(tmpdir(), 'check-source-links-'))
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'protocol.file.allow=always', '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

// The "public repository": one pushed commit.
const origin = join(root, 'origin')
mkdirSync(origin)
git(origin, 'init', '-q')
writeFileSync(join(origin, 'lib.rb'), 'a\nb\nc\n')
git(origin, 'add', '.')
git(origin, 'commit', '-q', '-m', 'pushed')
const pushed = git(origin, 'rev-parse', 'HEAD')

/** A CI-shaped checkout: no branches, one shallow detached revision. */
function ciCheckout() {
  const dir = mkdtempSync(join(root, 'ci-'))
  git(dir, 'init', '-q')
  git(dir, 'remote', 'add', 'origin', origin)
  git(dir, 'fetch', '-q', '--depth=1', 'origin', pushed)
  git(dir, 'checkout', '-q', 'FETCH_HEAD')
  return dir
}

/** A developer checkout holding a commit nobody pushed. */
function unpushedCheckout() {
  const dir = mkdtempSync(join(root, 'dev-'))
  git(root, 'clone', '-q', origin, dir)
  writeFileSync(join(dir, 'lib.rb'), 'a\nb\nc\nd\n')
  git(dir, 'commit', '-q', '-am', 'local only')
  return dir
}

const models = join(root, 'models')
mkdirSync(models)
const model = (revision) => writeFileSync(join(models, 'ruby.json'), JSON.stringify({
  repo: 'owner/repo', revision,
  symbols: [{ id: 'A#b', source: { file: 'lib.rb', line: 2 }, signatures: [] }],
}))

// The stub host knows only `pushed`, and can be told to misbehave.
let mode = 'normal'
const server = createServer((req, res) => {
  if (mode === 'down') return req.socket.destroy()
  const sha = req.url.split('/').pop()
  if (req.url === `/repos/owner/repo/commits/${sha}` && sha === pushed) {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ sha }))
  } else res.writeHead(404).end('{}')
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const api = `http://127.0.0.1:${server.address().port}`

const run = (checkout) => new Promise((done) => {
  const child = spawn('node', [script, '--port', 'ruby'], {
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME,
      LIBTMUX_DOCS_CHECKOUT_RUBY: checkout,
      LIBTMUX_DOCS_SOURCE_LINKS_MODELS: models,
      LIBTMUX_DOCS_GITHUB_API: api,
    },
  })
  let out = ''
  child.stdout.on('data', (d) => (out += d))
  child.stderr.on('data', (d) => (out += d))
  child.on('close', (code) => done({ code, out }))
})

let failures = 0
const check = (name, ok, detail) => {
  if (ok) console.log(`ok   ${name}`)
  else { console.error(`FAIL ${name} — ${detail}`); failures++ }
}

model(pushed)
{
  const { code, out } = await run(ciCheckout())
  check('a detached shallow checkout of a pushed commit passes through the host check', code === 0 && out.includes('github.com'), `exited ${code}:\n${out}`)
}
{
  const dir = unpushedCheckout()
  const head = git(dir, 'rev-parse', 'HEAD')
  model(head)
  const { code, out } = await run(dir)
  check('an unpushed local commit with no remote branch fails', code !== 0 && out.includes('is on no public remote') && out.includes('GitHub has no commit'), `exited ${code}:\n${out}`)
}
{
  model(pushed)
  const dir = ciCheckout()
  const saved = server.listeners('request')[0]
  server.removeAllListeners('request')
  server.on('request', (req, res) => res.writeHead(404).end('{}'))
  const { code, out } = await run(dir)
  server.removeAllListeners('request')
  server.on('request', saved)
  check('a host 404 fails', code !== 0 && out.includes('HTTP 404'), `exited ${code}:\n${out}`)
}
{
  mode = 'down'
  const { code, out } = await run(ciCheckout())
  mode = 'normal'
  check('a network error fails with its reason', code !== 0 && out.includes('could not ask GitHub') && !out.includes('every source link resolves'), `exited ${code}:\n${out}`)
}
{
  // A developer checkout whose branch is on a public remote never asks the host.
  const dir = mkdtempSync(join(root, 'clone-'))
  git(root, 'clone', '-q', origin, dir)
  mode = 'down'
  const { code, out } = await run(dir)
  mode = 'normal'
  check('a commit on a public remote branch passes without the host', code === 0 && out.includes('origin'), `exited ${code}:\n${out}`)
}

server.close()
rmSync(root, { recursive: true, force: true })
if (failures) process.exit(1)
