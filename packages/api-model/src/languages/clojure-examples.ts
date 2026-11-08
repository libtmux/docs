import type { ApiSymbol, DocBlock } from '../model.ts'

interface ExampleFile { sourceFile: string; path: string; language?: string }
interface Program extends ExampleFile {
  id: string
  variant: string
  language: string
  description: string
  mainNamespace: string
  targets: string[]
  expectedOutput: string
  cliAliases?: string[]
  requiresControl?: boolean
  unsupportedOutput?: string
}

/** Attach the native Clojure catalog without changing the JVM example schema. */
export function attachCompleteClojureExamples(
  symbols: ApiSymbol[],
  read: (path: string) => string | undefined,
  source: { repo: string; revision: string },
): void {
  const raw = read('examples/api/clojure/manifest.json')
  if (!raw || source.repo !== 'libtmux/libtmux-java' || !/^[a-f0-9]{40}$/.test(source.revision)) {
    throw new Error('Clojure examples require their native catalog and source revision')
  }
  const manifest = JSON.parse(raw) as {
    schemaVersion: number; examples: Program[]; variants: { clojure: { files: ExampleFile[] } }
  }
  const files = manifest.variants?.clojure?.files
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.examples) || !manifest.examples.length ||
      !Array.isArray(files) || !files.length || files.length > 2 ||
      new Set(files.map((file) => file.path)).size !== files.length ||
      !files.every((file) => ['deps.edn', 'run.sh'].includes(file.path)) ||
      !files.some((file) => file.path === 'deps.edn')) {
    throw new Error('Invalid Clojure example catalog or setup')
  }
  const codeFor = (path: string): string => {
    if (!/^examples\/(?:[\w-]+\/)*[\w.-]+$/.test(path) || path.split('/').includes('..')) {
      throw new Error(`Invalid Clojure example source path: ${path}`)
    }
    const code = read(path)
    if (!code?.trim()) throw new Error(`Missing complete Clojure example file: ${path}`)
    return code
  }
  // A revision before libtmux-java#142 ships run.sh beside deps.edn; later ones start their own server.
  const launcher = files.some((file) => file.path === 'run.sh')
  const urlFor = (path: string) => `https://github.com/${source.repo}/blob/${source.revision}/${path}`
  const ids = new Set<string>()
  for (const program of manifest.examples) {
    const namespace = /^libtmux\.examples\.api\.[a-z][a-z-]*$/.test(program.mainNamespace ?? '')
    if (!program.id || ids.has(program.id) || program.variant !== 'clojure' || program.language !== 'clojure' ||
        !namespace || program.path !== `src/main/clojure/${program.mainNamespace.replaceAll('.', '/').replaceAll('-', '_')}.clj` ||
        program.sourceFile !== `examples/${program.path}` || !program.description?.trim() ||
        !program.expectedOutput?.trim() || !program.expectedOutput.endsWith('\n') ||
        !Array.isArray(program.targets) || !program.targets.length ||
        new Set(program.targets).size !== program.targets.length ||
        program.cliAliases && (program.cliAliases.length !== 1 || program.cliAliases[0] !== 'core-async') ||
        program.requiresControl && (!program.unsupportedOutput?.trim() || !program.unsupportedOutput.endsWith('\n'))) {
      throw new Error(`Invalid Clojure example metadata: ${program.id}`)
    }
    ids.add(program.id)
    const adapter = program.cliAliases?.includes('core-async')
    const publish = [':libtmux:publishToMavenLocal', ':libtmux-clojure:publishToMavenLocal',
      ...(adapter ? [':libtmux-clojure-core-async:publishToMavenLocal'] : [])]
    const blocks: NonNullable<DocBlock['examples']> = [{
      lang: 'console',
      intro: `${program.description} Use JDK 25 or newer, the Clojure CLI, Git and tmux on Linux or macOS, with /bin/cat and /bin/sh available. These packages are unpublished. In an empty directory, install this exact source into the consumer's isolated Maven repository:`,
      code: `$ git clone https://github.com/${source.repo} libtmux-source && \\\n  git -C libtmux-source checkout --detach ${source.revision} && \\\n  (cd libtmux-source && ./gradlew \\\n    ${publish.join(' \\\n    ')} \\\n    --console=plain \\\n    "-Dmaven.repo.local=$PWD/../m2")\n`,
    }, ...files.map((file) => ({
      lang: file.path === 'run.sh' ? 'sh' : 'clojure',
      intro: `Save this file as \`${file.path}\`. ${file.path === 'run.sh'
        ? 'The launcher creates and stops a private server, including after program failure, and reports leaked servers as errors.'
        : 'Dependencies resolve from the isolated m2 directory; the core.async dependency is only enabled by its alias.'}`,
      code: codeFor(file.sourceFile), sourceUrl: urlFor(file.sourceFile),
    })), {
      lang: 'clojure', intro: `Save the complete program as \`${program.path}\`, creating its parent directories. ${launcher ? "Closing its client leaves the launcher's server running." : 'It starts a private tmux server of its own and stops it when the program closes it.'}`,
      code: codeFor(program.sourceFile), sourceUrl: urlFor(program.sourceFile),
    }, {
      lang: 'console',
      intro: launcher ? 'Run it with the private fixture. Set TMUX_BIN to select another tmux binary:' : 'Run it. Put the tmux you want first on PATH:',
      code: `$ ${launcher ? 'sh run.sh ' : ''}clojure \\\n  -J-Dclojure.main.report=stderr \\\n  -M${adapter ? ':core-async' : ''} \\\n  -m ${program.mainNamespace}\n`,
    }, {
      lang: 'text', intro: program.requiresControl ? 'Expected output on tmux 3.7 or newer:' : 'Expected output:',
      code: program.expectedOutput,
    }]
    if (program.requiresControl) blocks.push({
      lang: 'text', intro: 'On an older supported tmux, the program reports the control capability refusal:',
      code: program.unsupportedOutput!,
    })
    for (const target of program.targets) {
      const matches = symbols.filter((symbol) => symbol.id === target)
      if (matches.length !== 1) throw new Error(`Clojure example target must resolve once: ${target}`)
      const symbol = matches[0]!
      symbol.doc = { summary: '', ...symbol.doc, examples: [...(symbol.doc?.examples ?? []), ...blocks] }
    }
  }
}
