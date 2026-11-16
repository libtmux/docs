#!/usr/bin/env node
/** Exercise revision binding and deliberately damaged example caches. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, renameSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import * as generator from './gen-example-sources.mjs'

const { cachedExample } = generator

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

  // A file a port moved: the entry names both paths and the revision holds one.
  const commit = (message) => {
    git('add', '--all')
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', message)
    return git('rev-parse', 'HEAD')
  }
  const moved = ['runner/run.py', 'run.sh']
  const choose = (revision, current = {}, checkout = scratch) =>
    generator.cachedAlternative({ repository: 'fixture/example', revision, files: moved, checkout, current })
  const neither = git('rev-parse', 'HEAD')
  writeFileSync(join(scratch, 'run.sh'), '#!/bin/sh\n# old layout\n')
  const oldOnly = commit('Old layout')
  mkdirSync(join(scratch, 'runner'))
  renameSync(join(scratch, 'run.sh'), join(scratch, 'runner/run.py'))
  const newOnly = commit('New layout')
  writeFileSync(join(scratch, 'run.sh'), '#!/bin/sh\n# old layout again\n')
  const both = commit('Both layouts')

  assert.equal(choose(oldOnly).file, 'run.sh')
  assert.equal(choose(oldOnly).cached.content, '#!/bin/sh\n# old layout\n')
  assert.equal(choose(newOnly).file, 'runner/run.py')
  assert.equal(choose(newOnly).cached.content, '#!/bin/sh\n# old layout\n')
  assert.equal(choose(both).file, 'runner/run.py', 'the first alternative the revision holds wins')
  console.log('ok   an alternative the revision holds is read, whichever layout it is')

  assert.throws(() => choose(neither), /fixture\/example: none of runner\/run\.py, run\.sh exists at [a-f0-9]{40}/)
  assert.throws(() => choose('0'.repeat(40)), /0{40}/)
  assert.throws(() => generator.cachedAlternative({ repository: 'fixture/example', revision: neither, files: ['run.sh'], checkout: scratch, current: {} }), /run\.sh/)
  console.log('ok   no alternative at the revision fails, naming each path tried')

  const offlineMoved = (revision, current) => choose(revision, current, join(scratch, 'absent'))
  const cachedOld = choose(oldOnly).cached
  assert.equal(offlineMoved(oldOnly, { 'run.sh': cachedOld }).file, 'run.sh')
  assert.throws(() => offlineMoved(oldOnly, {}), /fixture\/example: none of runner\/run\.py, run\.sh is cached for [a-f0-9]{40}/)
  assert.throws(() => offlineMoved(newOnly, { 'run.sh': cachedOld }), /none of runner\/run\.py, run\.sh is cached/)
  console.log('ok   without a checkout, only an alternative cached for the revision is used')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
