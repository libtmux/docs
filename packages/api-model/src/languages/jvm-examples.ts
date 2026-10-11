import type { ApiSymbol, DocBlock } from '../model.ts'
import { qualifiedNameOf } from '../modules.ts'

type JvmPort = 'java' | 'kotlin' | 'scala'
type Variant = 'java' | 'kotlin' | 'scala-direct' | 'scala-cats'
interface SourceFile {
  sourceFile: string
  path: string
}
interface Program extends SourceFile {
  id: string
  variant: Variant
  language: JvmPort
  description: string
  mainClass: string
  targets: string[]
  expectedOutput: string
}
interface Manifest {
  schemaVersion: number
  examples: Program[]
  variants: Record<Variant, { files: SourceFile[] }>
}

const languages: Record<Variant, JvmPort> = {
  java: 'java',
  kotlin: 'kotlin',
  'scala-direct': 'scala',
  'scala-cats': 'scala',
}
const setupLanguages: Record<string, string> = {
  'settings.gradle.kts': 'kotlin',
  'build.gradle.kts': 'kotlin',
  'gradle.properties': 'properties',
  'run.sh': 'sh',
}

/** Read every displayed file from the same committed source revision as its citation. */
export function attachCompleteJvmExamples(
  symbols: ApiSymbol[],
  port: JvmPort,
  read: (path: string) => string | undefined,
  source: { repo: string; revision: string },
): void {
  const raw = read('examples/api/manifest.json')
  if (raw === undefined) return
  const manifest = JSON.parse(raw) as Manifest
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.examples) || !manifest.variants) {
    throw new Error('Invalid JVM example manifest')
  }
  if (!/^[0-9a-f]{40}$/.test(source.revision) || !/^[\w][\w.-]*\/[\w][\w.-]*$/.test(source.repo)) {
    throw new Error('JVM examples require a repository and full source revision')
  }
  const codeFor = (path: string): string => {
    if (!/^examples\/(?:[\w-]+\/)*[\w.-]+$/.test(path) || path.split('/').includes('..')) {
      throw new Error(`Invalid JVM example source path: ${path}`)
    }
    const code = read(path)
    if (!code?.trim()) throw new Error(`Missing complete JVM example file: ${path}`)
    return code
  }
  const urlFor = (path: string) => `https://github.com/${source.repo}/blob/${source.revision}/${path}`
  const ids = new Set<string>()
  for (const program of manifest.examples) {
    if (!Object.hasOwn(languages, program.variant) || languages[program.variant] !== program.language) {
      throw new Error(`Invalid JVM example variant: ${program.id}`)
    }
    if (program.language !== port) continue
    if (
      typeof program.id !== 'string' ||
      !program.id ||
      ids.has(program.id) ||
      !Array.isArray(program.targets) ||
      !program.targets.length ||
      !program.targets.every((target) => typeof target === 'string' && target.length && !/\s/.test(target)) ||
      typeof program.description !== 'string' ||
      !program.description.trim() ||
      typeof program.expectedOutput !== 'string' ||
      !program.expectedOutput.trim() ||
      !program.expectedOutput.endsWith('\n') ||
      !/^io\.github\.libtmux(?:\.[\w$]+)+$/.test(program.mainClass) ||
      !new RegExp(`^src/main/${port}/(?:[\\w]+/)*[\\w]+\\.${port === 'kotlin' ? 'kt' : port}$`).test(program.path)
    ) {
      throw new Error(`Invalid JVM example metadata: ${program.id}`)
    }
    ids.add(program.id)
    const files = manifest.variants[program.variant]?.files
    if (
      !Array.isArray(files) ||
      files.length !== 4 ||
      new Set(files.map((file) => file.path)).size !== 4 ||
      !files.every((file) => Object.hasOwn(setupLanguages, file.path))
    ) {
      throw new Error(`Invalid JVM example setup: ${program.variant}`)
    }
    const blocks: NonNullable<DocBlock['examples']> = [
      {
        lang: 'console',
        intro: `${program.description.replace(/\n/g, ' ')} Use JDK 25, Git, and tmux 3.2a through 3.7c on Linux, with /bin/cat and /bin/sh available. In an empty directory, fetch the documented library revision:`,
        code: `$ git clone https://github.com/${source.repo}.git libtmux-source && \\\n  git -C libtmux-source checkout ${source.revision}\n`,
      },
    ]
    for (const file of files)
      blocks.push({
        lang: setupLanguages[file.path],
        intro:
          file.path === 'run.sh'
            ? 'Save this launcher as run.sh. It creates and stops a private tmux server, including after program failure. A shutdown failure retains its socket directory and exits unsuccessfully.'
            : `Save this consumer setup as ${file.path}:`,
        sourceUrl: urlFor(file.sourceFile),
        code: codeFor(file.sourceFile),
      })
    blocks.push(
      {
        lang: port,
        intro: `Save this complete program as ${program.path}. It opens an ordinary client for the launcher's server; closing the client releases its transport.`,
        sourceUrl: urlFor(program.sourceFile),
        code: codeFor(program.sourceFile),
      },
      {
        lang: 'console',
        intro:
          'Build the minimal consumer and run the saved program with the private fixture. An operation or cleanup error makes the command exit unsuccessfully:',
        code: `$ ./libtmux-source/gradlew --project-dir . --console=plain --quiet \\\n    installDist -PexampleMain=${program.mainClass} && \\\n  sh run.sh build/install/api-example/bin/api-example\n`,
      },
      { lang: 'text', intro: 'Expected output:', code: program.expectedOutput },
    )
    const targets = new Set<string>()
    for (const target of program.targets) {
      if (targets.has(target)) throw new Error(`Duplicate JVM example target: ${target}`)
      const matches = symbols.filter((symbol) =>
        port === 'java' ? qualifiedNameOf(symbol) === target : symbol.id === target,
      )
      if (matches.length !== 1) throw new Error(`JVM example target must resolve once: ${target}`)
      targets.add(target)
      const symbol = matches[0]
      symbol.doc = { summary: '', ...symbol.doc, examples: [...(symbol.doc?.examples ?? []), ...blocks] }
    }
  }
}
