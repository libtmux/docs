import { describe, expect, it } from 'vitest'
import { attachCompleteJvmExamples } from '../src/languages/jvm-examples.ts'
import type { ApiSymbol } from '../src/model.ts'

const source = { repo: 'libtmux/libtmux-java', revision: 'a'.repeat(40) }
const variants = ['java', 'kotlin', 'scala-direct', 'scala-cats'] as const
const fixture = () => {
  const files = new Map<string, string>()
  const examples = variants.map((variant) => {
    const language = variant.startsWith('scala') ? 'scala' : (variant as 'java' | 'kotlin')
    const extension = language === 'kotlin' ? 'kt' : language
    const name = variant.replace('-', '')
    const path = `examples/src/main/${language}/${name}/Connect.${extension}`
    files.set(path, `\npackage example\n// ${variant} whole program bytes\n\n`)
    return {
      id: `${variant}-Connect`,
      variant,
      language,
      description: `Connect with ${variant}.`,
      sourceFile: path,
      mainClass: `io.github.libtmux.examples.${name}.Connect`,
      targets: [`${name}.Server`],
      expectedOutput: 'connected=true\n',
      path: `src/main/${language}/Connect.${extension}`,
    }
  })
  const manifest = {
    schemaVersion: 1,
    examples,
    variants: Object.fromEntries(
      variants.map((variant) => [
        variant,
        {
          files: ['settings.gradle.kts', 'build.gradle.kts', 'gradle.properties', 'run.sh'].map((path) => {
            const sourceFile = `examples/api/${variant}/${path}`
            files.set(sourceFile, `${variant} ${path}\n`)
            return { path, sourceFile }
          }),
        },
      ]),
    ),
  }
  const symbols: ApiSymbol[] = examples.map((program) => ({
    id: program.variant === 'java' ? 'java.Server.Server' : program.targets[0],
    publicId: program.variant === 'java' ? 'java.Server.Server' : program.targets[0],
    qualifiedName: program.targets[0],
    name: 'Server',
    kind: 'class',
    modifiers: [],
    signatures: [],
    slug: `${program.variant}-server`,
    source: { file: 'Server' },
    doc: { summary: 'Existing native documentation.' },
  }))
  const read = (path: string) => (path === 'examples/api/manifest.json' ? JSON.stringify(manifest) : files.get(path))
  return { files, manifest, symbols, read }
}

describe('complete JVM API programs', () => {
  it.each(['java', 'kotlin', 'scala'] as const)(
    'attaches only %s programs with every source-owned setup file',
    (port) => {
      const { manifest, symbols, files, read } = fixture()
      const identities = symbols.map(({ id, publicId, qualifiedName, slug }) => ({ id, publicId, qualifiedName, slug }))
      attachCompleteJvmExamples(symbols, port, read, source)
      expect(symbols.map(({ id, publicId, qualifiedName, slug }) => ({ id, publicId, qualifiedName, slug }))).toEqual(
        identities,
      )
      for (const [i, program] of manifest.examples.entries()) {
        const blocks = symbols[i].doc?.examples
        if (program.language !== port) {
          expect(blocks).toBeUndefined()
          continue
        }
        expect(symbols[i].doc?.summary).toBe('Existing native documentation.')
        expect(blocks).toHaveLength(8)
        const displayed = [...manifest.variants[program.variant].files, program]
        displayed.forEach((file, index) => {
          expect(blocks![index + 1].code).toBe(files.get(file.sourceFile))
          expect(blocks![index + 1].sourceUrl).toBe(
            `https://github.com/${source.repo}/blob/${source.revision}/${file.sourceFile}`,
          )
          expect(blocks![index + 1].intro).toContain(file.path)
        })
        expect(blocks![5].lang).toBe(port)
        expect(blocks![0].code).toContain(`git -C libtmux-source checkout ${source.revision}`)
        expect(blocks![6].code).toBe(
          `$ ./libtmux-source/gradlew --project-dir . --console=plain --quiet \\\n    installDist -PexampleMain=${program.mainClass} && \\\n  sh run.sh build/install/api-example/bin/api-example\n`,
        )
        expect(blocks![7]).toEqual({ lang: 'text', intro: 'Expected output:', code: program.expectedOutput })
      }
    },
  )

  it('keeps older source revisions without a manifest unchanged', () => {
    const { symbols } = fixture()
    const before = structuredClone(symbols)
    attachCompleteJvmExamples(symbols, 'java', () => undefined, source)
    expect(symbols).toEqual(before)
  })

  it('keeps two distinct complete programs attached to the same API page', () => {
    const { symbols, manifest, files, read } = fixture()
    const first = manifest.examples[0]
    const second = {
      ...first,
      id: 'java-Query',
      mainClass: first.mainClass.replace('Connect', 'Query'),
      sourceFile: first.sourceFile.replace('Connect', 'Query'),
      path: first.path.replace('Connect', 'Query'),
      description: 'Query sessions.',
      expectedOutput: 'matches=1\n',
    }
    files.set(second.sourceFile, '\n// Complete query program\n\n')
    manifest.examples.push(second)
    attachCompleteJvmExamples(symbols, 'java', read, source)
    const blocks = symbols[0].doc!.examples!
    expect(blocks).toHaveLength(16)
    for (const [index, program] of [first, second].entries()) {
      expect(blocks[index * 8 + 5].code).toBe(files.get(program.sourceFile))
      expect(blocks[index * 8 + 6].code).toContain(`-PexampleMain=${program.mainClass}`)
      expect(blocks[index * 8 + 7].code).toBe(program.expectedOutput)
    }
  })

  it('requires an exact unique canonical Java target without renaming its public identity', () => {
    for (const symbols of [[], [...fixture().symbols, fixture().symbols[0]]]) {
      expect(() => attachCompleteJvmExamples(symbols, 'java', fixture().read, source)).toThrow(
        'must resolve once: java.Server',
      )
    }
    const { manifest, symbols, read } = fixture()
    manifest.examples[0].targets = ['java.Server.Server']
    expect(() => attachCompleteJvmExamples(symbols, 'java', read, source)).toThrow(
      'must resolve once: java.Server.Server',
    )
  })

  it('rejects duplicate attachments and mismatched language variants', () => {
    const duplicate = fixture()
    duplicate.manifest.examples[0].targets.push('java.Server')
    expect(() => attachCompleteJvmExamples(duplicate.symbols, 'java', duplicate.read, source)).toThrow(
      'Duplicate JVM example target',
    )
    const wrong = fixture()
    wrong.manifest.examples[0].language = 'kotlin'
    expect(() => attachCompleteJvmExamples(wrong.symbols, 'java', wrong.read, source)).toThrow(
      'Invalid JVM example variant',
    )
  })

  it('rejects incomplete setup, missing source bytes and unsafe commands or paths', () => {
    const setup = fixture()
    setup.manifest.variants.java.files.pop()
    expect(() => attachCompleteJvmExamples(setup.symbols, 'java', setup.read, source)).toThrow(
      'Invalid JVM example setup',
    )
    const missing = fixture()
    missing.files.delete(missing.manifest.examples[0].sourceFile)
    expect(() => attachCompleteJvmExamples(missing.symbols, 'java', missing.read, source)).toThrow(
      'Missing complete JVM example file',
    )
    const path = fixture()
    path.manifest.examples[0].sourceFile = 'examples/../private.txt'
    expect(() => attachCompleteJvmExamples(path.symbols, 'java', path.read, source)).toThrow(
      'Invalid JVM example source path',
    )
    const command = fixture()
    command.manifest.examples[0].mainClass += '; echo injected'
    expect(() => attachCompleteJvmExamples(command.symbols, 'java', command.read, source)).toThrow(
      'Invalid JVM example metadata',
    )
  })

  it('requires public source provenance for every displayed file', () => {
    const { symbols, read } = fixture()
    expect(() => attachCompleteJvmExamples(symbols, 'java', read, { ...source, revision: 'main' })).toThrow(
      'full source revision',
    )
  })
})
