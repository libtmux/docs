import { describe, expect, it } from 'vitest'
import type { ApiSymbol } from '../model.ts'
import { attachCompleteCxxExamples } from './cxx-examples.ts'

const source = { repo: 'libtmux/libtmux-cxx', revision: 'a'.repeat(40) }
const symbol = (): ApiSymbol => ({
  id: 'libtmux::Server', name: 'Server', slug: 'libtmux-server', kind: 'class',
  signatures: [], modifiers: [], source: { file: 'include/libtmux/server.hpp' },
  doc: { summary: 'A tmux server address.', examples: [{ lang: 'cpp', code: 'const int old = 1;\n' }] },
})
const fixture = () => {
  const manifest = {
    schemaVersion: 1, projectFile: 'examples/api/project/CMakeLists.txt',
    programs: [{ id: 'server', symbols: ['libtmux::Server'], title: 'List sessions',
      description: 'Read the server listing.', expectedOutput: 'api\n', file: 'examples/api/server.cpp' }],
  }
  const projectCode = 'cmake_minimum_required(VERSION 3.25)\nproject(example LANGUAGES CXX)\n'
  const programCode = '#include <libtmux/libtmux.hpp>\nint main() { return 0; }\n'
  const files: Record<string, string> = {
    'examples/api/project/CMakeLists.txt': projectCode,
    'examples/api/server.cpp': programCode,
  }
  const read = (path: string) => path === 'examples/api/api-examples.json'
    ? JSON.stringify(manifest) : files[path]
  return { manifest, files, read, projectCode, programCode }
}

describe('complete C++ API examples', () => {
  it('preserves existing documentation and exact whole files at their pinned revision', () => {
    const { read, projectCode, programCode } = fixture()
    const target = symbol()
    attachCompleteCxxExamples([target], read, source)
    expect(target.doc?.summary).toBe('A tmux server address.')
    const blocks = target.doc!.examples!
    expect(blocks[0].code).toBe('const int old = 1;\n')
    expect(blocks[3].code).toBe(projectCode)
    expect(blocks[4].code).toBe(programCode)
    expect(blocks[3].sourceUrl).toBe(
      `https://github.com/${source.repo}/blob/${source.revision}/examples/api/project/CMakeLists.txt`)
    expect(blocks[4].sourceUrl).toBe(
      `https://github.com/${source.repo}/blob/${source.revision}/examples/api/server.cpp`)
    expect(blocks[1].code).toContain(`git -C libtmux-source checkout ${source.revision}`)
    expect(blocks[2].code).toContain('-DLIBTMUX_BUILD_TESTING_LIBRARY=ON')
    expect(blocks[5].code).toContain('-DCMAKE_PREFIX_PATH="$PWD/libtmux-prefix"')
    expect(blocks[6].code).toBe('api\n')
  })

  it('leaves older source revisions without a manifest unchanged', () => {
    const target = symbol()
    const original = structuredClone(target)
    attachCompleteCxxExamples([target], () => undefined, source)
    expect(target).toEqual(original)
  })

  it.each([
    ['unknown target', (f: ReturnType<typeof fixture>) => { f.manifest.programs[0].symbols = ['libtmux::Unknown'] }],
    ['duplicate target', (f: ReturnType<typeof fixture>) => { f.manifest.programs[0].symbols.push('libtmux::Server') }],
    ['duplicate program', (f: ReturnType<typeof fixture>) => { f.manifest.programs.push(f.manifest.programs[0]) }],
    ['missing program', (f: ReturnType<typeof fixture>) => { delete f.files[f.manifest.programs[0].file] }],
    ['missing project', (f: ReturnType<typeof fixture>) => { delete f.files[f.manifest.projectFile] }],
    ['partial file', (f: ReturnType<typeof fixture>) => { f.files[f.manifest.programs[0].file] = 'int main() {}' }],
    ['hidden entry point', (f: ReturnType<typeof fixture>) => { f.files[f.manifest.programs[0].file] = 'void example() {}\n' }],
    ['unsafe path', (f: ReturnType<typeof fixture>) => { f.manifest.programs[0].file = '../server.cpp' }],
    ['unexpected project', (f: ReturnType<typeof fixture>) => { f.manifest.projectFile = 'CMakeLists.txt' }],
    ['empty output', (f: ReturnType<typeof fixture>) => { f.manifest.programs[0].expectedOutput = '' }],
    ['missing output newline', (f: ReturnType<typeof fixture>) => { f.manifest.programs[0].expectedOutput = 'api' }],
    ['missing description', (f: ReturnType<typeof fixture>) => { f.manifest.programs[0].description = ' ' }],
    ['unsupported schema', (f: ReturnType<typeof fixture>) => { f.manifest.schemaVersion = 2 }],
  ])('rejects %s', (_name, change) => {
    const f = fixture()
    change(f)
    expect(() => attachCompleteCxxExamples([symbol()], f.read, source)).toThrow('Invalid complete C++ examples:')
  })

  it('rejects ambiguous identities, unpinned revisions and a foreign repository', () => {
    const { read } = fixture()
    expect(() => attachCompleteCxxExamples([symbol(), symbol()], read, source)).toThrow('resolve once')
    expect(() => attachCompleteCxxExamples([symbol()], read, { ...source, revision: 'master' })).toThrow('full revision')
    expect(() => attachCompleteCxxExamples([symbol()], read, { ...source, repo: 'other/repo' })).toThrow('C++ repository')
  })
})
