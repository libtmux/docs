#!/usr/bin/env node
/** Exercise revision binding and deliberately damaged example caches. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { cachedExample } from './gen-example-sources.mjs'

const scratch = mkdtempSync(join(tmpdir(), 'libtmux-example-cache-'))
const git = (...args) => execFileSync('git', ['-C', scratch, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim()
try {
  git('init', '--quiet')
  writeFileSync(join(scratch, 'example.go'), '// committed example\n')
  git('add', 'example.go')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Example')
  const revision = git('rev-parse', 'HEAD')
  const request = { repository: 'fixture/example', revision, file: 'example.go', checkout: scratch }
  const initial = cachedExample(request)
  assert.equal(initial.content, '// committed example\n')
  writeFileSync(join(scratch, 'example.go'), '// uncommitted replacement\n')
  assert.deepEqual(cachedExample(request), initial)
  git('add', 'example.go')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Later revision')
  assert.deepEqual(cachedExample(request), initial)
  console.log('ok   examples ignore a dirty working tree and a later HEAD')

  const offline = { ...request, checkout: join(scratch, 'absent'), current: initial }
  assert.deepEqual(cachedExample(offline), initial)
  assert.throws(() => cachedExample({ ...offline, current: { ...initial, content: 'damaged' } }), /no verified cache/)
  assert.throws(() => cachedExample({ ...offline, revision: git('rev-parse', 'HEAD') }), /no verified cache/)
  assert.throws(() => cachedExample({ ...offline, repository: 'another/repo' }), /no verified cache/)
  assert.throws(() => cachedExample({ ...offline, current: undefined }), /no verified cache/)
  assert.throws(() => cachedExample({ ...request, file: 'missing.go' }))
  console.log('ok   missing files, wrong revisions, wrong repositories and damaged bytes fail')

  // A port with no configured checkout has an empty path. joined with `.git` it names the
  // current directory's repository, which is another project's and holds neither commit.
  const decoy = join(scratch, 'decoy')
  mkdirSync(decoy)
  execFileSync('git', ['-C', decoy, 'init', '--quiet'])
  writeFileSync(join(decoy, 'other.txt'), 'unrelated\n')
  execFileSync('git', ['-C', decoy, 'add', 'other.txt'])
  execFileSync('git', ['-C', decoy, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Unrelated'])
  const before = process.cwd()
  process.chdir(decoy)
  try {
    assert.deepEqual(cachedExample({ ...offline, checkout: '' }), initial)
    assert.throws(() => cachedExample({ ...offline, checkout: '', current: undefined }), /no verified cache/)
  } finally {
    process.chdir(before)
  }
  console.log('ok   an empty checkout path is absent, whatever repository the current directory holds')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
