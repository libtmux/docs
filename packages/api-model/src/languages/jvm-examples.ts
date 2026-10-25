import type { ApiSymbol, DocBlock } from '../model.ts'
import { qualifiedNameOf } from '../modules.ts'

type JvmPort = 'java' | 'kotlin' | 'scala'
type Variant = 'java' | 'kotlin' | 'scala-direct' | 'scala-cats'
interface SourceFile { sourceFile: string; path: string }
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
  java: 'java', kotlin: 'kotlin', 'scala-direct': 'scala', 'scala-cats': 'scala',
}
const setupLanguages: Record<string, string> = {
  'settings.gradle.kts': 'kotlin', 'build.gradle.kts': 'kotlin',
  'gradle.properties': 'properties', 'run.sh': 'sh',
}

/**
 * Read every displayed file from the same committed source revision as its citation.
 *
 * The port's consumer builds include the source checkout at its development
 * version; readers get the same setup depending on the newest release tag the
 * documented revision contains, the version its release workflow publishes to
 * Maven Central. Neither gradle.properties value is kept equal to that release.
 */
export function attachCompleteJvmExamples(
  symbols: ApiSymbol[],
  port: JvmPort,
  read: (path: string) => string | undefined,
  source: { repo: string; revision: string; releaseTag?: string },
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
  const development = /^libtmuxVersion=(\S+-SNAPSHOT)$/m.exec(read('gradle.properties') ?? '')?.[1]
  if (!development) throw new Error('JVM examples require the development version in gradle.properties')
  const release = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)$/.exec(source.releaseTag ?? '')?.[1]
  if (!release) throw new Error('JVM examples require a release tag in the documented revision')
  // The consumer setup minus the source build: settings stop before includeBuild, and the dependency names the release.
  const released = (path: string, code: string): string => {
    if (path === 'settings.gradle.kts') {
      const at = code.indexOf('includeBuild("libtmux-source")')
      if (at < 0) throw new Error('JVM example settings must include the source build')
      return `${code.slice(0, at).trimEnd()}\n`
    }
    if (path !== 'build.gradle.kts') return code
    const dependency = /(implementation\("io\.github\.libtmux:[\w-]+:)([^"]+)("\))/g
    const matches = [...code.matchAll(dependency)]
    if (matches.length !== 1 || matches[0][2] !== development) {
      throw new Error('JVM example build must depend on the source build version')
    }
    return code.replace(dependency, `$1${release}$3`)
  }
  const ids = new Set<string>()
  for (const program of manifest.examples) {
    if (!Object.hasOwn(languages, program.variant) || languages[program.variant] !== program.language) {
      throw new Error(`Invalid JVM example variant: ${program.id}`)
    }
    if (program.language !== port) continue
    if (typeof program.id !== 'string' || !program.id || ids.has(program.id) ||
        !Array.isArray(program.targets) || !program.targets.length ||
        !program.targets.every((target) => typeof target === 'string' && target.length && !/\s/.test(target)) ||
        typeof program.description !== 'string' || !program.description.trim() ||
        typeof program.expectedOutput !== 'string' || !program.expectedOutput.trim() ||
        !program.expectedOutput.endsWith('\n') ||
        !/^io\.github\.libtmux(?:\.[\w$]+)+$/.test(program.mainClass) ||
        !new RegExp(`^src/main/${port}/(?:[\\w]+/)*[\\w]+\\.${port === 'kotlin' ? 'kt' : port}$`).test(program.path)) {
      throw new Error(`Invalid JVM example metadata: ${program.id}`)
    }
    ids.add(program.id)
    const files = manifest.variants[program.variant]?.files
    if (!Array.isArray(files) || files.length !== 4 || new Set(files.map((file) => file.path)).size !== 4 ||
        !files.every((file) => Object.hasOwn(setupLanguages, file.path))) {
      throw new Error(`Invalid JVM example setup: ${program.variant}`)
    }
    const blocks: NonNullable<DocBlock['examples']> = files.map((file, index) => {
      const code = codeFor(file.sourceFile)
      const shown = released(file.path, code)
      return {
        lang: setupLanguages[file.path],
        intro: [
          index === 0 ? `${program.description.replace(/\n/g, ' ')} Use JDK 25, Gradle 9 or newer, and tmux 3.3a or newer on Linux, with \`/bin/cat\` and \`/bin/sh\` available. In an empty directory,` : '',
          file.path === 'run.sh'
            ? 'Save this launcher as `run.sh`. It creates and stops a private tmux server, including after program failure. A shutdown failure retains its socket directory and exits unsuccessfully.'
            : file.path === 'build.gradle.kts'
              ? `Save this consumer setup as \`build.gradle.kts\`. It depends on the ${release} release from Maven Central:`
              : `${index === 0 ? 'save' : 'Save'} this consumer setup as \`${file.path}\`:`,
        ].filter(Boolean).join(' '),
        // A rewritten file is no longer the port's committed bytes, so it has no source citation.
        ...(shown === code ? { sourceUrl: urlFor(file.sourceFile) } : {}),
        code: shown,
      }
    })
    blocks.push({
      lang: port,
      intro: `Save this complete program as \`${program.path}\`. It opens an ordinary client for the launcher's server; closing the client releases its transport.`,
      sourceUrl: urlFor(program.sourceFile), code: codeFor(program.sourceFile),
    }, {
      lang: 'console',
      intro: 'Build the minimal consumer with Gradle and run the saved program with the private fixture. An operation or cleanup error makes the command exit unsuccessfully:',
      code: `$ gradle --console=plain --quiet installDist -PexampleMain=${program.mainClass} && \\\n  sh run.sh build/install/api-example/bin/api-example\n`,
    }, { lang: 'text', intro: 'Expected output:', code: program.expectedOutput })
    const targets = new Set<string>()
    for (const target of program.targets) {
      if (targets.has(target)) throw new Error(`Duplicate JVM example target: ${target}`)
      const matches = symbols.filter((symbol) => port === 'java' ? qualifiedNameOf(symbol) === target : symbol.id === target)
      if (matches.length !== 1) throw new Error(`JVM example target must resolve once: ${target}`)
      targets.add(target)
      const symbol = matches[0]
      symbol.doc = { summary: '', ...symbol.doc, examples: [...(symbol.doc?.examples ?? []), ...blocks] }
    }
  }
}
