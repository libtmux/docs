/** Verify rendered Rust copy payloads, then run the source-bound external consumers. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Window } from 'happy-dom'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { parse } from 'smol-toml'
import { pageSlug } from '../packages/api-model/src/prose.ts'
import { rustWorkspaceLayout } from '../packages/api-model/src/languages/rust-workspace.ts'
import { assertCompleteApiExample, readCompleteApiExample } from '../site/scripts/check-clipboard.mjs'

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const json = (file) => JSON.parse(readFileSync(file, 'utf8'))
const commands = (code) => code.replace(/^\$ /gm, '').trim()
const Parser = new Window().DOMParser

/** Match every source-owned target page to native files and both rendered exports. */
export function collectRustExampleProof({ model, sourceRoot, renderedRoot }) {
  assert(model.port === 'rs' && model.repo === 'libtmux/libtmux-rs' && /^[a-f0-9]{40}$/.test(model.revision), 'exact Rust model identity')
  const read = (file) => existsSync(join(sourceRoot, file)) ? readFileSync(join(sourceRoot, file), 'utf8') : undefined
  const layout = rustWorkspaceLayout(read)
  const roots = layout ? ['libtmux-tokio', 'libtmux'] : ['libtmux']
  const examples = []
  const pages = []
  for (const name of roots) {
    const manifest = json(join(sourceRoot, `crates/${name}/examples/api/manifest.json`))
    assert.equal(manifest.schemaVersion, 1)
    for (const program of manifest.examples) {
      assert(/^rust-[a-z]+$/.test(program.id) && program.cargoExample === program.id.replace('rust-', 'api_'), 'source program identity')
      assert.equal(program.sourceFile, `crates/${name}/examples/${program.cargoExample}.rs`)
      const native = readFileSync(join(sourceRoot, program.sourceFile))
      assert(native.at(-1) === 10 && !native.includes(13), 'complete LF source file')
      const url = `https://github.com/${model.repo}/blob/${model.revision}/${program.sourceFile}`
      const owners = model.symbols.flatMap((symbol) => (symbol.doc?.examples ?? [])
        .flatMap((block, index) => block.sourceUrl === url ? [{ symbol, block, index }] : []))
      assert.equal(owners.length, program.targets.length, `${program.id}: every native target has one attached program`)
      assert.equal(new Set(owners.map(({ symbol }) => symbol.id)).size, owners.length, 'unique native target owners')
      if (layout) assert.deepEqual(owners.map(({ symbol }) => symbol.publicId ?? symbol.id).sort(),
        program.targets.map((target) => target.replaceAll('::', '.')).sort(), 'native target owners')
      let selected
      for (const { symbol, block, index } of owners) {
        assert(Buffer.from(block.code).equals(native), `${program.id}: model program equals native file`)
        const blocks = symbol.doc.examples
        assert.deepEqual(blocks.slice(index - 1, index + 3).map((entry) => entry.lang), ['console', 'rust', 'console', 'text'])
        assert.equal(blocks[index + 2].code, `${program.expectedOutput}\n`)
        const slug = symbol.slug ?? pageSlug(symbol.publicId ?? symbol.id)
        const example = {
          port: 'rs', symbol: symbol.id, publicId: symbol.publicId ?? symbol.id,
          page: `ports/rs/reference/${slug}`, sourceProgramId: program.id,
          sourceRepository: model.repo, sourceRevision: model.revision, sourceFile: program.sourceFile,
          files: [{ block: index, name: 'src/main.rs', path: 'src/main.rs', sourceFile: program.sourceFile,
            sha256: hash(native), clipboardSha256: hash(native.subarray(0, -1)) }],
          consoleBlocks: [index - 1, index + 1],
          shellRecipe: [commands(blocks[index - 1].code), commands(blocks[index + 1].code)],
          expectedOutputs: [[], [program.expectedOutput]],
          expectedOutputHex: Buffer.from(`${program.expectedOutput}\n`).toString('hex'),
        }
        if (layout) assert(example.shellRecipe[0].includes(`--rev ${model.revision}`), 'source-pinned install recipe')
        const htmlFile = join(renderedRoot, `reference/${slug}/index.html`)
        const markdownFile = join(renderedRoot, `reference/${slug}.md`)
        const rendered = readCompleteApiExample({ html: readFileSync(htmlFile, 'utf8'), symbol: example.publicId }, Parser)
        assert(rendered, `${program.id}: rendered Examples section`)
        assertCompleteApiExample(rendered, example)
        assert.equal(rendered.files[index + 2], program.expectedOutput, 'HTML expected-output bytes')
        const markdown = readFileSync(markdownFile, 'utf8')
        const fences = fromMarkdown(markdown).children.filter((node) => node.type === 'code')
        const nativeFences = fences.flatMap((entry, at) => entry.lang === 'rust' && hash(`${entry.value}\n`) === hash(native) ? [at] : [])
        assert.equal(nativeFences.length, 1, 'Markdown program equals one native file')
        const at = nativeFences[0]
        assert(fences[at + 2]?.lang === 'text' && `${fences[at + 2].value}\n` === blocks[index + 2].code, 'Markdown expected-output bytes')
        assert(fences[at - 1]?.lang === 'console' && commands(fences[at - 1].value) === example.shellRecipe[0], 'Markdown install recipe')
        assert(fences[at + 1]?.lang === 'console' && commands(fences[at + 1].value) === example.shellRecipe[1], 'Markdown run recipe')
        assert(markdown.includes(`](${url})`), 'Markdown pinned source citation')
        pages.push({ symbol: symbol.id, htmlSha256: hash(readFileSync(htmlFile)), markdownSha256: hash(readFileSync(markdownFile)) })
        selected ??= example
      }
      assert(selected, `${program.id}: one complete program to execute`)
      examples.push(selected)
    }
  }
  const expectedArchivePackages = readdirSync(join(sourceRoot, 'crates')).flatMap((name) => {
    const raw = read(`crates/${name}/Cargo.toml`)
    if (!raw) return []
    const manifest = parse(raw)
    return manifest.package?.publish === false ? [] : [manifest.package.name]
  }).sort()
  return { sourceRevision: model.revision, expectedArchivePackages,
    recorderSha256: hash(readFileSync(new URL('./example_tmux_sandbox.py', import.meta.url))), examples, pages }
}

/** Join staged normalized archive evidence to the copied mixed program and native bytes. */
export function verifyArchiveRecord(proof, record, archiveRoot) {
  assert(archiveRoot, 'physical staged archives are required')
  assert.equal(record.sourceRevision, proof.sourceRevision, 'archive source revision')
  assert.equal(record.sourceDirty, false, 'archive source must be clean')
  assert.equal(record.passed, true, 'archive execution passed')
  assert.equal(record.recorder.repository, 'https://github.com/libtmux/docs', 'shared recorder repository')
  assert(/^[a-f0-9]{40}$/.test(record.recorder.revision), 'exact shared recorder revision')
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
    assert(/^[a-z][a-z0-9-]*$/.test(archive.package) && /^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(archive.version) && /^[a-f0-9]{64}$/.test(archive.sha256), 'archive identity and digest')
    const matches = actualFiles.filter((file) => file.endsWith(`/${archive.package}-${archive.version}.crate`))
    assert.equal(matches.length, 1, 'one physical staged archive')
    assert.equal(hash(readFileSync(matches[0])), archive.sha256, 'physical archive digest')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const option = (name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const sourceRoot = resolve(option('--source') ?? '')
  const renderedRoot = resolve(option('--rendered') ?? '')
  const output = resolve(option('--output-dir') ?? '')
  assert(option('--source') && option('--rendered') && option('--output-dir'), '--source, --rendered and --output-dir are required')
  assert(!option('--archive-record') || option('--archive-dir'), '--archive-record requires --archive-dir')
  const modelFile = join(root, 'site/src/data/api/rs.json')
  const model = json(modelFile)
  assert.equal(execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), model.revision, 'source checkout HEAD')
  const proof = collectRustExampleProof({ model, sourceRoot, renderedRoot })
  proof.docsRevision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  mkdirSync(output, { recursive: true })
  const receipt = join(output, 'examples.json')
  writeFileSync(receipt, `${JSON.stringify(proof, null, 2)}\n`)
  const results = []
  if (!args.includes('--check-only')) for (const example of proof.examples) {
    const target = join(output, example.sourceProgramId)
    execFileSync('python3', [join(root, 'scripts/check-example-prose.py'), '--example', 'api', '--port', 'rs',
      '--program', example.sourceProgramId, '--verification-manifest', receipt, '--api-model', modelFile,
      '--output-dir', target, example.sourceProgramId === 'rust-mixed' ? '--native-capture' : '--native-stdio'],
    { cwd: root, stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: join(output, 'cargo-target') } })
    const native = json(join(target, 'native/result.json'))
    assert(native.passed && native.stdoutHex === example.expectedOutputHex, 'native copied program stdout and cleanup')
    if (proof.expectedArchivePackages.includes('libtmux-core')) {
      const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--format-version', '1'], { cwd: target, encoding: 'utf8' }))
      const cores = metadata.packages.filter((entry) => entry.name === 'libtmux-core')
      assert(cores.length === 1 && cores[0].source?.endsWith(`#${model.revision}`), 'one installed core at the pinned Git source')
    }
    results.push({ program: example.sourceProgramId, sourceSha256: example.files[0].sha256, native })
  }
  if (option('--archive-record')) verifyArchiveRecord(proof, json(option('--archive-record')), option('--archive-dir'))
  writeFileSync(join(output, 'proof.json'), `${JSON.stringify({ ...proof, results,
    archiveRecordSha256: option('--archive-record') ? hash(readFileSync(option('--archive-record'))) : undefined }, null, 2)}\n`)
  console.log(`Rust copy proof: ${proof.examples.length} programs, ${proof.pages.length} HTML/Markdown pages${args.includes('--check-only') ? '' : ', native Git readers passed'}`)
}
