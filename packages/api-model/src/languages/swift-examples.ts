import type { ApiSymbol, DocBlock } from '../model.ts'

interface SwiftExample {
  name: string
  symbols: string[]
  title: string
  description: string
  expectedOutput: string[]
  file: string
}

interface SwiftExamples {
  schemaVersion: number
  packageFile: string
  examples: SwiftExample[]
}

/** Attach whole Swift programs and their consumer package at the cited revision. */
export function attachCompleteSwiftExamples(
  symbols: ApiSymbol[],
  read: (path: string) => string | undefined,
  source: { repo: string; revision: string },
): void {
  const raw = read('Examples/api-examples.json')
  if (raw === undefined) return
  const manifest = JSON.parse(raw) as SwiftExamples
  const require = (condition: unknown, message: string): void => {
    if (!condition) throw new Error(`Invalid complete Swift examples: ${message}`)
  }
  require(source.repo === 'libtmux/libtmux-swift' && /^[a-f0-9]{40}$/.test(source.revision),
    'source must name the Swift repository and a full revision')
  require(manifest?.schemaVersion === 1 && Array.isArray(manifest.examples) && manifest.examples.length,
    'unsupported or empty manifest')
  require(manifest.packageFile === 'Examples/Standalone/Package.swift', 'unexpected consumer package')
  const codeFor = (path: string): string => {
    const code = read(path)
    if (!code?.trim() || !code.endsWith('\n') || code.includes('\r')) {
      throw new Error(`Invalid complete Swift examples: missing complete LF source: ${path}`)
    }
    return code
  }
  const urlFor = (path: string) => `https://github.com/${source.repo}/blob/${source.revision}/${path}`
  const packageCode = codeFor(manifest.packageFile)
  const names = new Set<string>()
  const targets = new Set<string>()
  for (const example of manifest.examples) {
    require(/^Api[A-Z][A-Za-z0-9]*$/.test(example.name) && !names.has(example.name),
      'invalid or duplicate program name')
    names.add(example.name)
    require(example.file === `Examples/Sources/${example.name}/${example.name}.swift`,
      'unexpected program path')
    require(typeof example.title === 'string' && example.title.trim() &&
      typeof example.description === 'string' && example.description.trim(), 'task description is missing')
    require(Array.isArray(example.expectedOutput) && example.expectedOutput.length &&
      example.expectedOutput.every((line) => typeof line === 'string' && !/[\r\n]/.test(line)) &&
      example.expectedOutput.some((line) => line.trim()), 'expected output is missing')
    require(Array.isArray(example.symbols) && example.symbols.length &&
      example.symbols.every((id) => typeof id === 'string' && id && !/\s/.test(id)),
      'API targets are missing')
    const programCode = codeFor(example.file)
    const blocks: NonNullable<DocBlock['examples']> = [
      {
        lang: 'console',
        intro: `${example.title}. ${example.description.replace(/\n/g, ' ')} Use Swift 6.2.4 on Linux or Xcode 26's Swift 6.3 toolchain on macOS, Git, and tmux 3.2a or newer. In an empty directory, fetch the documented library revision:`,
        code: `$ git clone https://github.com/${source.repo}.git libtmux-source && \\\n  git -C libtmux-source checkout ${source.revision}\n`,
      },
      {
        lang: 'swift',
        intro: 'Save this complete consumer package as Package.swift:',
        sourceUrl: urlFor(manifest.packageFile),
        code: packageCode,
      },
      {
        lang: 'swift',
        intro: 'Create a Sources directory and save this complete program as Sources/Example.swift. The `withTmuxServer` fixture owns a private tmux server and stops it after success or failure. Ordinary application code uses `Server` for its own socket; these examples use the fixture until their setup moves to ordinary server objects.',
        sourceUrl: urlFor(example.file),
        code: programCode,
      },
      {
        lang: 'console',
        intro: 'Build and run the saved program. An operation or cleanup error produces a failing exit status. Set LIBTMUX_TMUX_BIN to an absolute executable path to select a tmux version:',
        code: '$ swift run --jobs 5 ApiExample\n',
      },
      { lang: 'text', intro: 'Expected output:', code: `${example.expectedOutput.join('\n')}\n` },
    ]
    for (const id of example.symbols) {
      require(!targets.has(id), `duplicate API target: ${id}`)
      const matches = symbols.filter((symbol) => symbol.id === id)
      require(matches.length === 1, `API target must resolve once: ${id}`)
      targets.add(id)
      const symbol = matches[0]
      symbol.doc = { summary: '', ...symbol.doc, examples: [...(symbol.doc?.examples ?? []), ...blocks] }
    }
  }
}
