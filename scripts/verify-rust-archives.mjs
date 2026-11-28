/** Join copied readers, repeat renders and physical Rust archives without dependencies. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const json = (file) => JSON.parse(readFileSync(file, 'utf8'))
const sha = /^[a-f0-9]{40}$/
const digest = /^[a-f0-9]{64}$/
const programs = ['rust-construction', 'rust-listings', 'rust-creation', 'rust-query',
  'rust-cardinality', 'rust-input', 'rust-capture', 'rust-mixed'].sort()
const packages = ['libtmux-core', 'libtmux-blocking', 'libtmux-tokio', 'libtmux',
  'libtmux-macros', 'tmux-workspace', 'tmux-mcp'].sort()

/** Join staged normalized archive evidence to the copied mixed program and native bytes. */
export function verifyArchiveRecord(proof, record, archiveRoot) {
  assert(archiveRoot, 'physical staged archives are required')
  assert.equal(record.sourceRevision, proof.sourceRevision, 'archive source revision')
  assert.equal(record.sourceDirty, false, 'archive source must be clean')
  assert.equal(record.passed, true, 'archive execution passed')
  assert.equal(record.recorder.repository, 'https://github.com/libtmux/docs', 'shared recorder repository')
  assert(sha.test(record.recorder.revision), 'exact shared recorder revision')
  assert.equal(record.recorder.sha256, proof.recorderSha256, 'same shared recorder bytes')
  if (proof.docsRevision) assert.equal(record.recorder.revision, proof.docsRevision, 'same shared recorder revision')
  const mixed = proof.examples.find((entry) => entry.sourceProgramId === 'rust-mixed')
  assert(mixed, 'mixed program exists')
  assert.equal(record.mixed.programSha256, mixed.files[0].sha256, 'archive/copied program bytes')
  assert.equal(record.mixed.stdoutHex, mixed.expectedOutputHex, 'archive raw output bytes')
  assert.equal(record.mixed.profile, 'raw-stdout-native-capture', 'archive witness profile')
  assert(record.mixed.cleanup.required === true && record.mixed.cleanup.passed === true, 'archive program completed cleanup')
  assert.equal(record.mixed.native.beforeHex, mixed.expectedOutputHex, 'native before bytes')
  assert.equal(record.mixed.native.afterHex, mixed.expectedOutputHex, 'native after bytes')
  assert(/^%\d+$/.test(record.mixed.native.pane) && record.mixed.native.generation.pid > 0, 'native pane generation')
  assert.deepEqual(record.archives.map((entry) => entry.package).sort(), proof.expectedArchivePackages, 'complete staged archive set')
  const files = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)])
  const actualFiles = files(archiveRoot)
  for (const archive of record.archives) {
    assert(/^[a-z][a-z0-9-]*$/.test(archive.package) && /^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(archive.version) && digest.test(archive.sha256), 'archive identity and digest')
    const matches = actualFiles.filter((file) => file.endsWith(`/${archive.package}-${archive.version}.crate`))
    assert.equal(matches.length, 1, 'one physical staged archive')
    assert.equal(hash(readFileSync(matches[0])), archive.sha256, 'physical archive digest')
  }
}

/** Require the complete current native-layout proof at the caller's exact two pins. */
export function verifyRustArchiveJoin(copy, native, archiveRoot, repeat, expectedSource, expectedDocs) {
  assert(sha.test(expectedSource) && sha.test(expectedDocs), 'exact expected source and docs revisions')
  assert.equal(copy.sourceRevision, expectedSource, 'copied source revision')
  assert.equal(copy.docsRevision, expectedDocs, 'copied docs revision')
  assert.equal(repeat.sourceRevision, expectedSource, 'repeat source revision')
  assert.equal(repeat.docsRevision, expectedDocs, 'repeat docs revision')
  assert(repeat.schemaVersion === 1 && repeat.passed === true && repeat.cleanInputs === true, 'completed clean repeat')
  assert(digest.test(repeat.inputSnapshotSha256), 'captured repeat inputs')
  for (const component of ['Tree', 'Model', 'Search']) {
    const first = repeat[`first${component}Sha256`]
    assert(digest.test(first), `repeat ${component} digest`)
    assert.equal(first, repeat[`second${component}Sha256`], `repeat ${component} bytes`)
  }
  assert.deepEqual(repeat.llms.map((entry) => entry.path).sort(), ['llms-full.txt', 'llms.txt'], 'both llms exports')
  for (const entry of repeat.llms) assert(digest.test(entry.firstSha256) && entry.firstSha256 === entry.secondSha256, 'repeat llms bytes')
  assert.equal(copy.modelSha256, repeat.firstModelSha256, 'copied model matches repeated model')
  assert.deepEqual(copy.expectedArchivePackages, packages, 'seven native-layout packages')
  assert.deepEqual(copy.examples.map((entry) => entry.sourceProgramId).sort(), programs, 'eight source-bound copied programs')
  assert.deepEqual(copy.results.map((entry) => entry.program).sort(), programs, 'every copied program ran once')
  for (const result of copy.results) {
    const example = copy.examples.find((entry) => entry.sourceProgramId === result.program)
    assert.equal(result.sourceSha256, example.files[0].sha256, 'executed native source bytes')
    assert.equal(result.native.stdoutHex, example.expectedOutputHex, 'copied program stdout bytes')
    assert(result.native.passed === true && result.native.status === 0 && result.native.timedOut === false &&
      result.native.cleanup.required === true && result.native.cleanup.passed === true, 'copied program completed cleanup')
    if (result.program === 'rust-mixed') {
      assert.equal(result.native.native.beforeHex, example.expectedOutputHex, 'copied mixed native before bytes')
      assert.equal(result.native.native.afterHex, example.expectedOutputHex, 'copied mixed native after bytes')
    }
  }
  assert.deepEqual(native.guideExamples.map((entry) => entry.program).sort(),
    programs.filter((program) => program !== 'rust-mixed'), 'seven staged guide programs ran once')
  for (const guide of native.guideExamples) {
    const example = copy.examples.find((entry) => entry.sourceProgramId === guide.program)
    assert.equal(guide.programSha256, example.files[0].sha256, 'staged/copied guide source bytes')
    assert.equal(guide.stdoutHex, example.expectedOutputHex, 'staged/copied guide stdout bytes')
    assert(guide.cleanup.required === true && guide.cleanup.passed === true, 'staged guide completed cleanup')
  }
  verifyArchiveRecord(copy, native, archiveRoot)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [copyFile, nativeFile, archiveRoot, repeatFile, expectedSource, expectedDocs] = process.argv.slice(2)
  assert(process.argv.length === 8, 'usage: verify-rust-archives.mjs COPY.json NATIVE.json ARCHIVE_ROOT REPEAT.json SOURCE_SHA DOCS_SHA')
  const copy = json(copyFile)
  const repeat = json(repeatFile)
  verifyRustArchiveJoin(copy, json(nativeFile), archiveRoot, repeat, expectedSource, expectedDocs)
  const proofRoot = dirname(copyFile)
  const snapshotFile = join(proofRoot, 'input-snapshot.json')
  assert.equal(hash(readFileSync(snapshotFile)), repeat.inputSnapshotSha256, 'physical captured input snapshot')
  const inputs = json(snapshotFile)
  assert.equal(inputs.docs.sha, expectedDocs, 'captured docs revision')
  assert.equal(inputs.docs.dirty, false, 'captured docs clean')
  assert.equal(inputs.sources.length, 1, 'one captured Rust source')
  assert.equal(inputs.sources[0].sha, expectedSource, 'captured source revision')
  assert.equal(inputs.sources[0].dirty, false, 'captured source clean')
  for (const which of ['first', 'second']) {
    const manifest = json(join(proofRoot, `${which}-tree.json`))
    assert.equal(hash(JSON.stringify(manifest)), repeat[`${which}TreeSha256`], 'physical repeat tree manifest')
    const row = (path) => {
      const rows = manifest.filter((entry) => entry.path === path)
      assert.equal(rows.length, 1, `one physical manifest row: ${path}`)
      return rows[0]
    }
    assert.equal(row('reference/tree.json').sha256, repeat[`${which}SearchSha256`], 'physical manifest search bytes')
    for (const entry of repeat.llms) assert.equal(row(entry.path).sha256, entry[`${which}Sha256`], 'physical manifest llms bytes')
    assert.equal(hash(readFileSync(join(proofRoot, `api-model.${which}.json`))), repeat[`${which}ModelSha256`], 'physical repeated model')
  }
  console.log(`Rust copied readers, repeat renders and seven archives verified at ${expectedSource}`)
}
