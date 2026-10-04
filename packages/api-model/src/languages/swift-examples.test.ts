import { describe, expect, it } from 'vitest'
import type { ApiSymbol } from '../model.ts'
import { attachCompleteSwiftExamples } from './swift-examples.ts'

const source = { repo: 'libtmux/libtmux-swift', revision: 'a'.repeat(40) }
const symbol = (): ApiSymbol => ({
  id: 'Server',
  name: 'Server',
  slug: 'server',
  kind: 'struct',
  signatures: [],
  modifiers: [],
  source: { file: 'Sources/LibTmux/Server.swift' },
  doc: { summary: 'A tmux server address.', examples: [{ lang: 'swift', code: 'let old = true\n' }] },
})
const fixture = () => {
  const manifest = {
    schemaVersion: 1,
    packageFile: 'Examples/Standalone/Package.swift',
    examples: [
      {
        name: 'ApiServer',
        symbols: ['Server'],
        title: 'List sessions',
        description: 'Read the server listing.',
        expectedOutput: ['bootstrap'],
        file: 'Examples/Sources/ApiServer/ApiServer.swift',
      },
    ],
  }
  const packageCode = '// swift-tools-version: 6.2\nimport PackageDescription\n'
  const programCode = 'import LibTmux\n@main struct ApiServer { static func main() {} }\n'
  const files: Record<string, string> = {
    'Examples/Standalone/Package.swift': packageCode,
    'Examples/Sources/ApiServer/ApiServer.swift': programCode,
  }
  const read = (path: string) => (path === 'Examples/api-examples.json' ? JSON.stringify(manifest) : files[path])
  return { manifest, files, read, packageCode, programCode }
}

describe('complete Swift API examples', () => {
  it('preserves existing docs and exact complete source with pinned citations', () => {
    const { read, packageCode, programCode } = fixture()
    const target = symbol()
    attachCompleteSwiftExamples([target], read, source)
    expect(target.doc?.summary).toBe('A tmux server address.')
    expect(target.doc?.examples?.[0].code).toBe('let old = true\n')
    expect(target.doc?.examples?.slice(1).map((block) => block.code)).toEqual([
      `$ git clone https://github.com/${source.repo}.git libtmux-source && \\\n  git -C libtmux-source checkout ${source.revision}\n`,
      packageCode,
      programCode,
      '$ swift run --jobs 5 ApiExample\n',
      'bootstrap\n',
    ])
    expect(target.doc?.examples?.[2].sourceUrl).toBe(
      `https://github.com/${source.repo}/blob/${source.revision}/Examples/Standalone/Package.swift`,
    )
    expect(target.doc?.examples?.[3].sourceUrl).toBe(
      `https://github.com/${source.repo}/blob/${source.revision}/Examples/Sources/ApiServer/ApiServer.swift`,
    )
  })

  it('leaves older source revisions without a manifest unchanged', () => {
    const target = symbol()
    const original = structuredClone(target)
    attachCompleteSwiftExamples([target], () => undefined, source)
    expect(target).toEqual(original)
  })

  it.each([
    [
      'unknown target',
      (f: ReturnType<typeof fixture>) => {
        f.manifest.examples[0].symbols = ['Unknown']
      },
    ],
    [
      'duplicate target',
      (f: ReturnType<typeof fixture>) => {
        f.manifest.examples[0].symbols.push('Server')
      },
    ],
    [
      'duplicate program',
      (f: ReturnType<typeof fixture>) => {
        f.manifest.examples.push(f.manifest.examples[0])
      },
    ],
    [
      'missing program',
      (f: ReturnType<typeof fixture>) => {
        delete f.files[f.manifest.examples[0].file]
      },
    ],
    [
      'missing package',
      (f: ReturnType<typeof fixture>) => {
        delete f.files[f.manifest.packageFile]
      },
    ],
    [
      'partial file',
      (f: ReturnType<typeof fixture>) => {
        f.files[f.manifest.examples[0].file] = 'import LibTmux'
      },
    ],
    [
      'unsafe path',
      (f: ReturnType<typeof fixture>) => {
        f.manifest.examples[0].file = '../Example.swift'
      },
    ],
    [
      'unexpected package',
      (f: ReturnType<typeof fixture>) => {
        f.manifest.packageFile = 'Package.swift'
      },
    ],
    [
      'empty output',
      (f: ReturnType<typeof fixture>) => {
        f.manifest.examples[0].expectedOutput = []
      },
    ],
    [
      'multiline output item',
      (f: ReturnType<typeof fixture>) => {
        f.manifest.examples[0].expectedOutput = ['x\ny']
      },
    ],
    [
      'missing description',
      (f: ReturnType<typeof fixture>) => {
        f.manifest.examples[0].description = ' '
      },
    ],
    [
      'unsupported schema',
      (f: ReturnType<typeof fixture>) => {
        f.manifest.schemaVersion = 2
      },
    ],
  ])('rejects %s', (_name, change) => {
    const f = fixture()
    change(f)
    expect(() => attachCompleteSwiftExamples([symbol()], f.read, source)).toThrow('Invalid complete Swift examples:')
  })

  it('rejects ambiguous identities, unpinned revisions and unexpected repositories', () => {
    const { read } = fixture()
    expect(() => attachCompleteSwiftExamples([symbol(), symbol()], read, source)).toThrow('resolve once')
    expect(() => attachCompleteSwiftExamples([symbol()], read, { ...source, revision: 'master' })).toThrow(
      'full revision',
    )
    expect(() => attachCompleteSwiftExamples([symbol()], read, { ...source, repo: 'other/repo' })).toThrow(
      'Swift repository',
    )
  })
})
