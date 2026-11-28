import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { compareRustRenders, repeatNativeRustBuild } from '../../../scripts/repeat-rust-build.mjs'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const temp = () => { const root = mkdtempSync(join(tmpdir(), 'rust-repeat-test-')); dirs.push(root); return root }
const write = (path: string, bytes: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes) }
const inputs = () => ({ schema: 1, port: 'rs', locale: 'en', version: 'latest',
  docs: { repository: 'libtmux/docs', sha: 'b'.repeat(40), dirty: false },
  sources: [{ product: 'core', repository: 'libtmux/libtmux-rs', sha: 'a'.repeat(40), dirty: false }] })

function fixture() {
  const root = temp()
  const firstRoot = join(root, 'first')
  const secondRoot = join(root, 'second')
  const selected = inputs()
  for (const tree of [firstRoot, secondRoot]) {
    for (const [path, bytes] of [['index.html', '<h1>Rust</h1>'], ['reference/tree.json', '{"entries":[]}'],
      ['llms.txt', '# Rust\n'], ['llms-full.txt', '# Rust full\n'],
      ['build-provenance.json', JSON.stringify(selected)], ['_assets/app.js', 'const library = "tmux"']]) write(join(tree, path), bytes)
  }
  const firstModel = join(root, 'first-model.json')
  const secondModel = join(root, 'second-model.json')
  for (const file of [firstModel, secondModel]) write(file, JSON.stringify({ revision: selected.sources[0].sha }))
  return { firstRoot, secondRoot, firstModel, secondModel, inputs: selected }
}

describe('Rust clean repeat render', () => {
  it('compares full manifests including provenance, API model, API search and both llms exports', () => {
    const compared = compareRustRenders(fixture())
    expect(compared.receipt.firstTreeSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(compared.receipt.firstTreeSha256).toBe(compared.receipt.secondTreeSha256)
    expect(compared.first.some((entry: any) => entry.path === 'build-provenance.json')).toBe(true)
    expect(compared.receipt.llms.map((entry: any) => entry.path)).toEqual(['llms.txt', 'llms-full.txt'])
  })

  it.each(['reference/tree.json', 'llms.txt', 'llms-full.txt', '_assets/app.js', 'build-provenance.json'])('refuses changed %s bytes', (path) => {
    const f = fixture()
    write(join(f.secondRoot, path), 'changed')
    expect(() => compareRustRenders(f)).toThrow('repeat full version tree')
  })

  it('refuses extra and missing paths, changed models, dirty inputs and symlinks', () => {
    const f = fixture()
    write(join(f.secondRoot, 'extra'), 'unrecorded')
    expect(() => compareRustRenders(f)).toThrow()
    rmSync(join(f.secondRoot, 'extra'))
    rmSync(join(f.secondRoot, '_assets/app.js'))
    expect(() => compareRustRenders(f)).toThrow()
    write(join(f.secondRoot, '_assets/app.js'), 'const library = "tmux"')
    write(f.secondModel, '{}')
    expect(() => compareRustRenders(f)).toThrow('repeat API model bytes')
    write(f.secondModel, readFileSync(f.firstModel, 'utf8'))
    f.inputs.docs.dirty = true
    expect(() => compareRustRenders(f)).toThrow('clean pinned docs input')
    f.inputs.docs.dirty = false
    symlinkSync(f.firstModel, join(f.secondRoot, 'linked-model.json'))
    expect(() => compareRustRenders(f)).toThrow('no symlinks')
  })

  it('runs the same official command from fresh clean source/docs worktrees and fresh outputs', () => {
    const root = temp()
    const docsRoot = join(root, 'docs')
    const sourceRoot = join(root, 'source')
    const bin = join(root, 'bin')
    const trace = join(root, 'trace.jsonl')
    const commit = (path: string) => {
      execFileSync('git', ['init', '-q', path])
      execFileSync('git', ['-C', path, 'add', '.'])
      execFileSync('git', ['-C', path, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'])
      return execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    }
    for (const name of ['libtmux-core', 'libtmux-blocking', 'libtmux-tokio', 'libtmux']) {
      write(join(sourceRoot, `crates/${name}/Cargo.toml`), `[package]\nname = "${name}"\n`)
    }
    write(join(sourceRoot, 'Cargo.lock'), '# pinned native dependencies\n')
    write(join(sourceRoot, 'rust-toolchain.toml'), '[toolchain]\nchannel="1.97.1"\n')
    const source = commit(sourceRoot)
    write(join(docsRoot, 'package.json'), '{"packageManager":"pnpm@12.15.0"}\n')
    write(join(docsRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    write(join(docsRoot, '.gitignore'), '_site/\nnode_modules/\n.build-cache/\n')
    write(join(docsRoot, 'site/src/data/api/rs.json'), JSON.stringify({ revision: source }))
    const build = join(docsRoot, 'scripts/build-site.sh')
    write(build, `#!${process.execPath}
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
assert.deepEqual(process.argv.slice(2), ['--ports','rs','--versions','latest','--skip-refs','--skip-pagefind']);
assert(!fs.existsSync('_site')); assert(fs.existsSync('node_modules'));
const input=JSON.parse(fs.readFileSync(process.env.LIBTMUX_DOCS_INPUT_SNAPSHOT));
fs.appendFileSync(process.env.REPEAT_TRACE, JSON.stringify({build:process.cwd(), source:process.env.PORT_CHECKOUT, target:process.env.CARGO_TARGET_DIR})+'\\n');
for (const [file,bytes] of [['index.html','<h1>Rust</h1>'],['reference/tree.json','{}'],['llms.txt','Rust'],['llms-full.txt','Rust full'],['build-provenance.json',JSON.stringify(input)]]) {
const target=path.join('_site/en/rs/latest',file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);}
`)
    execFileSync('chmod', ['+x', build])
    const docs = commit(docsRoot)
    const selected = inputs(); selected.docs.sha = docs; selected.sources[0].sha = source
    const inputSnapshot = join(root, 'inputs.json')
    write(inputSnapshot, JSON.stringify(selected))
    for (const tool of ['pnpm', 'cargo', 'rustc', 'tmux']) {
      const path = join(bin, tool)
      write(path, `#!${process.execPath}
const fs=require('node:fs');
if (process.argv.includes('--version') || process.argv.includes('-V')) console.log('fixture-version');
else {require('node:assert/strict').deepEqual(process.argv.slice(2),['install','--frozen-lockfile']);fs.mkdirSync('node_modules');fs.appendFileSync(process.env.REPEAT_TRACE,JSON.stringify({setup:process.cwd()})+'\\n');}
`)
      execFileSync('chmod', ['+x', path])
    }
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, REPEAT_TRACE: trace,
      LIBTMUX_DOCS_PORT: 'rs', LIBTMUX_DOCS_VERSION: 'latest', LIBTMUX_DOCS_SOURCE_REF: source,
      LIBTMUX_DOCS_SOURCE_SHA: source, LIBTMUX_DOCS_INPUT_SNAPSHOT: inputSnapshot, PORT_CHECKOUT: sourceRoot }
    execFileSync('pnpm', ['install', '--frozen-lockfile'], { cwd: docsRoot, env })
    execFileSync(build, ['--ports', 'rs', '--versions', 'latest', '--skip-refs', '--skip-pagefind'], { cwd: docsRoot, env })
    const output = join(root, 'proof')
    const result = repeatNativeRustBuild({ docsRoot, sourceRoot, renderedRoot: join(docsRoot, '_site/en/rs/latest'), inputSnapshot, output, env })
    expect(result.passed).toBe(true)
    expect(result.docsRevision).toBe(docs)
    expect(existsSync(join(output, 'repeat.json'))).toBe(true)
    const commands = readFileSync(trace, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    expect(commands.filter((entry) => entry.setup)).toHaveLength(2)
    const builds = commands.filter((entry) => entry.build)
    expect(builds).toHaveLength(2)
    expect(builds[1].build).not.toBe(docsRoot)
    expect(builds[1].source).not.toBe(sourceRoot)
    expect(builds[1].target).toContain('libtmux-rust-repeat-')
    expect(existsSync(builds[1].build)).toBe(false)
    expect(JSON.parse(readFileSync(join(output, 'api-model.second.json'), 'utf8')).revision).toBe(source)
  })
})
