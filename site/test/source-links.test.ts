import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiModel, ApiSymbol } from '../../packages/api-model/src/model.ts'
import { sourceUrl } from '../../packages/api-model/src/products.ts'

const root = new URL('../../', import.meta.url).pathname
const directories: string[] = []
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })))

function fixture(port: 'java' | 'kotlin' | 'scala' = 'kotlin', { generated = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'libtmux-source-links-'))
  directories.push(directory)
  const checkout = join(directory, 'checkout')
  mkdirSync(join(checkout, 'src'), { recursive: true })
  mkdirSync(join(directory, 'scripts'), { recursive: true })
  mkdirSync(join(directory, 'site/src/lib'), { recursive: true })
  mkdirSync(join(directory, 'site/src/data/api'), { recursive: true })
  copyFileSync(join(root, 'scripts/check-source-links.mjs'), join(directory, 'scripts/check-source-links.mjs'))
  writeFileSync(join(directory, 'site/src/lib/ports.ts'), `export const PORTS = ${JSON.stringify([{ slug: port, checkout }])}\n`)
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}')
  writeFileSync(join(checkout, 'src/Server.java'), 'package fixture;\nclass Server {}\n')
  const git = (...args: string[]) => execFileSync('git', ['-C', checkout, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  git('init', '-q')
  git('add', 'src/Server.java')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false',
    'commit', '-qm', 'Source link fixture')
  const revision = git('rev-parse', 'HEAD')
  git('update-ref', 'refs/remotes/origin/main', revision)
  const native = JSON.parse(readFileSync(join(root, `site/src/data/api/${port}.json`), 'utf8')) as ApiModel
  const declaration = structuredClone(native.symbols.find((symbol) => Object.hasOwn(native.generatedSources!, symbol.source.file))!)
  const file = declaration.source.file
  const content = native.generatedSources![file]
  declaration.source = { ...declaration.source, repo: 'fixture/library', revision, extractedRevision: revision }
  const ordinary: ApiSymbol = { id: 'Server', name: 'Server', kind: 'class', modifiers: [], signatures: [],
    source: { file: 'src/Server.java', line: 2 } }
  const model: ApiModel = { port, extractor: 'fixture', repo: 'fixture/library', revision,
    symbols: generated ? [ordinary, declaration] : [ordinary],
    ...(generated ? { generatedSources: { [file]: content } } : {}),
  }
  const invoke = () => {
    writeFileSync(join(directory, `site/src/data/api/${port}.json`), JSON.stringify(model))
    return spawnSync(process.execPath, [join(directory, 'scripts/check-source-links.mjs'), '--port', port], {
      encoding: 'utf8', timeout: 5000,
    })
  }
  return { model, native, ordinary, declaration, file, content, git, revision, invoke }
}

describe('source link audit', () => {
  it.each(['java', 'kotlin', 'scala'] as const)('accepts the embedded source route for a real %s declaration', (port) => {
    const { model, declaration, file, git, revision, invoke } = fixture(port)
    expect(sourceUrl(model, declaration, `/pr-42/en/${port}/v1/reference/`))
      .toBe(`/pr-42/en/${port}/v1/reference/sources/${file}`)
    expect(git('ls-tree', '--name-only', revision, '--', file)).toBe('')
    const result = invoke()
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).not.toContain('skipped')
  })

  it.each(['java', 'kotlin', 'scala'] as const)('checks every embedded %s catalog location against its emitted text', (port) => {
    const { model, native, ordinary, revision, invoke } = fixture(port)
    const generated = native.symbols.filter((symbol) => Object.hasOwn(native.generatedSources!, symbol.source.file))
    model.generatedSources = native.generatedSources
    model.symbols = [ordinary, ...generated.map((symbol) => ({ ...symbol,
      source: { ...symbol.source, repo: model.repo, revision, extractedRevision: revision },
    }))]
    const result = invoke()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain(`${generated.length} generated declaration and method locations, ${Object.keys(native.generatedSources!).length} embedded files`)
    expect(result.stdout).not.toContain('skipped')
  })

  it('requires an embedded entry instead of exempting generated-looking paths', () => {
    const { model, file, invoke } = fixture()
    delete model.generatedSources![file]
    const result = invoke()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`name a path absent at`)
    expect(result.stderr).toContain(file)
  })

  it('selects an embedded route by its catalog entry without a path-prefix convention', () => {
    const { model, ordinary, invoke } = fixture()
    model.symbols = [ordinary]
    model.generatedSources = { [ordinary.source.file]: 'package embedded;\nclass Server {}\n' }
    expect(sourceUrl(model, ordinary, '/en/kotlin/latest/reference/'))
      .toBe('/en/kotlin/latest/reference/sources/src/Server.java')
    const result = invoke()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('1 generated declaration and method locations')
  })

  it.each([null, [], 'text', 42])('rejects a malformed generated-source catalog: %j', (catalog) => {
    const { model, invoke } = fixture()
    model.generatedSources = catalog as unknown as Record<string, string>
    const result = invoke()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('generatedSources must map relative source paths to text')
  })

  it.each([null, {}, [], 42, true, '', '  \n', 'source\0text'])('rejects missing or non-text embedded content: %j', (content) => {
    const { model, file, invoke } = fixture()
    model.generatedSources![file] = content as unknown as string
    const result = invoke()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('must contain nonempty text')
  })

  it('rejects truncated embedded content using the actual declaration line', () => {
    const { model, file, declaration, invoke } = fixture()
    expect(declaration.source.line).toBeGreaterThan(1)
    model.generatedSources![file] = 'truncated source'
    const result = invoke()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('points outside embedded generated source')
  })

  it.each(['../Outside.kt', '/Outside.kt', 'src/../Outside.kt', 'src/./Outside.kt', 'src//Outside.kt',
    'src\\Outside.kt', 'src/%2e%2e/Outside.kt', 'src/Outside.kt?raw=1', 'src/Outside.kt#fragment',
    'C:/Outside.kt', 'src/Outside\n.kt'])('rejects a generated route path that changes its destination: %j', (file) => {
    const { model, declaration, content, invoke } = fixture()
    model.generatedSources = { [file]: content }
    declaration.source.file = file
    const result = invoke()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('is not a canonical relative path')
  })

  it('checks unreferenced embedded files because they also become source routes', () => {
    const { model, invoke } = fixture()
    model.generatedSources!['../Unused.kt'] = 'unreferenced source'
    const result = invoke()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('generated source "../Unused.kt" is not a canonical relative path')
  })

  it.each([0, -1, 1.5, '2', null, 100000])('rejects an invalid generated declaration line: %j', (line) => {
    const { declaration, invoke } = fixture()
    declaration.source.line = line as number
    const result = invoke()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('points outside embedded generated source')
  })

  it('checks generated signature locations independently of the owner source', () => {
    const { model, ordinary, declaration, content, invoke } = fixture()
    model.symbols = [ordinary]
    ordinary.signatures = [{ params: [], source: { ...declaration.source } }]
    const valid = invoke()
    expect(valid.status, valid.stderr).toBe(0)
    expect(valid.stdout).toContain('1 generated declaration and method locations')
    ordinary.signatures[0].source!.line = content.split('\n').length + 1
    const invalid = invoke()
    expect(invalid.status).toBe(1)
    expect(invalid.stderr).toContain('Server signature 1 points outside embedded generated source')
  })

  it('retains ordinary Git signature checks on an owner with embedded source', () => {
    const { declaration, invoke } = fixture()
    declaration.signatures = [{ params: [], source: { file: 'src/Missing.java', line: 1 } }]
    const result = invoke()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('name a path absent at')
    expect(result.stderr).toContain('src/Missing.java')
  })

  it('accepts a public Git source and an unspecified line', () => {
    const { ordinary, invoke } = fixture('java', { generated: false })
    expect(invoke().status).toBe(0)
    delete ordinary.source.line
    const result = invoke()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('1 without a line')
  })

  it('rejects a commit absent from the source repository', () => {
    const { model, invoke } = fixture('java', { generated: false })
    model.revision = '0'.repeat(40)
    const result = invoke()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('revision 00000000 is not in')
  })

  it('rejects a commit reachable only through the private remote', () => {
    const { git, revision, invoke } = fixture('java', { generated: false })
    git('update-ref', '-d', 'refs/remotes/origin/main')
    git('update-ref', 'refs/remotes/tony/main', revision)
    const result = invoke()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('on no public remote (tony)')
  })

  it.each(['src/Missing.java', '../Server.java', '/Server.java'])('rejects the absent or escaping Git path %s', (file) => {
    const { ordinary, invoke } = fixture('java', { generated: false })
    ordinary.source.file = file
    const result = invoke()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('name a path absent at')
  })

  it.each([0, 99])('rejects the out-of-range Git source line %s', (line) => {
    const { ordinary, invoke } = fixture('java', { generated: false })
    ordinary.source.line = line
    const result = invoke()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('point past the end of their file')
  })
})
