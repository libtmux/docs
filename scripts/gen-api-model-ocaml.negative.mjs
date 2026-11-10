#!/usr/bin/env node
/** Exercise producer input ownership against an exported OCaml checkout. No tmux or network. */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
const checkout = resolve(option('--checkout') ?? process.env.LIBTMUX_DOCS_CHECKOUT_OCAML ?? '')
assert(option('--checkout') || process.env.LIBTMUX_DOCS_CHECKOUT_OCAML, 'Provide --checkout with an exported native checkout')
assert.equal(args.length % 2, 0, 'Each option requires a value')
assert(args.every((arg, index) => index % 2 ? !arg.startsWith('--') : ['--checkout', '--generator'].includes(arg)), 'Unknown argument')
const generator = resolve(option('--generator') ?? join(root, 'scripts/gen-api-model.mjs'))
const artifactPath = '_build/docs/ocaml.json'
const artifactBytes = readFileSync(join(checkout, artifactPath))
const artifact = JSON.parse(artifactBytes)
assert.equal(artifact.schema, 'libtmux.ocaml-api/1')
assert.match(artifact.revision, /^[a-f0-9]{40}$/)
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const scratch = mkdtempSync(join(tmpdir(), 'libtmux-ocaml-producer-'))

try {
  const docs = join(scratch, 'docs')
  const native = join(scratch, 'port')
  mkdirSync(join(docs, 'scripts'), { recursive: true })
  mkdirSync(join(docs, 'site/src/data/api'), { recursive: true })
  mkdirSync(join(docs, 'site/src/lib'), { recursive: true })
  symlinkSync(join(root, 'packages'), join(docs, 'packages'), 'dir')
  symlinkSync(join(root, 'node_modules'), join(docs, 'node_modules'), 'dir')
  symlinkSync(join(root, 'scripts/lib'), join(docs, 'scripts/lib'), 'dir')
  for (const name of readdirSync(join(root, 'site/src/lib'))) {
    symlinkSync(join(root, 'site/src/lib', name), join(docs, 'site/src/lib', name))
  }
  copyFileSync(generator, join(docs, 'scripts/gen-api-model.mjs'))
  execFileSync('git', ['clone', '--quiet', '--shared', '--no-checkout', checkout, native], { stdio: 'pipe' })
  execFileSync('git', ['-C', native, 'checkout', '--quiet', '--detach', artifact.revision], { stdio: 'pipe' })
  for (const input of [...artifact.nativeProvenance.files, ...artifact.nativeProvenance.exporter.files]) {
    assert(!input.path.startsWith('/') && !input.path.split('/').includes('..'), 'Input escapes checkout')
    const destination = join(native, input.path)
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(join(checkout, input.path), destination)
    // Dune installs read-only artifacts; only this owned copy is mutated.
    chmodSync(destination, 0o600)
  }
  mkdirSync(dirname(join(native, artifactPath)), { recursive: true })
  writeFileSync(join(native, artifactPath), artifactBytes)
  const env = { ...process.env, LIBTMUX_DOCS_PORT: 'ocaml',
    LIBTMUX_DOCS_CHECKOUT_OCAML: native, LIBTMUX_DOCS_SOURCE_SHA: artifact.revision,
    LIBTMUX_DOCS_SOURCE_REF: artifact.revision }
  const run = () => spawnSync(process.execPath, [join(docs, 'scripts/gen-api-model.mjs'), '--port', 'ocaml'], {
    cwd: docs, env, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
  })
  const control = run()
  assert.equal(control.status, 0, `Valid compiled inputs and native exporter must pass:\n${control.stderr}`)
  assert.equal(JSON.parse(readFileSync(join(docs, 'site/src/data/api/ocaml.json'))).revision, artifact.revision)
  console.log('ok   installed compiler artifacts and native exporter produce the selected model')
  const outputDirectory = join(docs, 'site/src/data/api')
  const outputs = () => Object.fromEntries(readdirSync(outputDirectory).sort().map((name) =>
    [name, digest(readFileSync(join(outputDirectory, name)))]))
  const baseline = outputs()
  const rejected = (name, expected) => {
    const result = run()
    assert.ifError(result.error)
    assert.equal(result.signal, null, name)
    assert(Number.isInteger(result.status) && result.status !== 0, name)
    assert.match(result.stderr, expected, name)
    assert.deepEqual(outputs(), baseline, `${name}: output changed before rejection`)
    console.log(`ok   ${name}; output unchanged`)
  }
  const compiled = artifact.nativeProvenance.files.find((input) => input.path.endsWith('.cmti'))
  assert(compiled, 'Export must include a compiled public interface')
  const compiledPath = join(native, compiled.path)
  const savedCompiled = readFileSync(compiledPath)
  writeFileSync(compiledPath, Buffer.concat([savedCompiled, Buffer.from('changed')]))
  rejected('altered installed compiler artifact', /native artifact source differs/)
  writeFileSync(compiledPath, savedCompiled)

  const changedDigest = JSON.parse(artifactBytes)
  const source = changedDigest.nativeProvenance.files.find((input) => !input.path.startsWith('_build/'))
  assert(source, 'Export must include committed interface input')
  source.sha256 = '0'.repeat(64)
  writeFileSync(join(native, artifactPath), JSON.stringify(changedDigest))
  rejected('incorrect committed interface digest', /native artifact source differs/)
  writeFileSync(join(native, artifactPath), artifactBytes)

  const toolPath = join(native, artifact.nativeProvenance.exporter.files[0].path)
  const savedTool = readFileSync(toolPath)
  writeFileSync(toolPath, Buffer.concat([savedTool, Buffer.from('changed')]))
  rejected('altered native exporter bytes', /native artifact exporter is stale/)
  writeFileSync(toolPath, savedTool)

  const changedRevision = JSON.parse(artifactBytes)
  changedRevision.revision = '0'.repeat(40)
  writeFileSync(join(native, artifactPath), JSON.stringify(changedRevision))
  rejected('incorrect selected library revision', /library revision mismatch/)
} finally {
  rmSync(scratch, { recursive: true, force: true })
  assert(!existsSync(scratch), 'Temporary producer checkout remains')
}
console.log('gen-api-model-ocaml.negative: ownership and four rejection controls pass; temporary checkouts removed')
