import type { ApiSymbol, DocBlock } from '../model.ts'

interface Program {
  id: string
  profile: string
  title: string
  description: string
  sourceFile: string
  targets: string[]
  output: string
}
interface Manifest {
  schemaVersion: number
  profiles: Record<string, { package: string; projectFile: string; entrypoint: string }>
  setupFiles: string[]
  examples: Program[]
}

/** Attach source-verified compiler targets without changing the site's C# source identities. */
export function attachCompleteCSharpExamples(
  symbols: ApiSymbol[],
  read: (path: string) => string | undefined,
  source: { repo: string; revision: string },
): void {
  const raw = read('examples/api/manifest.json')
  if (raw === undefined) return
  const manifest = JSON.parse(raw) as Manifest
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.examples) || !manifest.examples.length ||
      JSON.stringify(manifest.setupFiles) !== JSON.stringify(['global.json', 'examples/api/NuGet.config'])) {
    throw new Error('Invalid C# example manifest')
  }
  const programs = manifest.examples.filter((program) => program.profile === 'csharp')
  const profile = manifest.profiles?.csharp
  if (!programs.length && !profile) return
  if (!programs.length) throw new Error('C# example profile has no complete programs')
  if (profile?.package !== 'LibTmux' || profile.projectFile !== 'examples/api/csharp/Example.csproj' ||
      profile.entrypoint !== 'Program.cs') throw new Error('Invalid C# example profile')
  if (source.repo !== 'libtmux/libtmux-dotnet' || !/^[0-9a-f]{40}$/.test(source.revision)) {
    throw new Error('C# examples require the public repository and full source revision')
  }
  const codeFor = (path: string): string => {
    if (path !== 'global.json' && !/^examples\/(?:[\w.-]+\/)*[\w.-]+$/.test(path) || path.split('/').includes('..')) {
      throw new Error(`Invalid C# example source path: ${path}`)
    }
    const code = read(path)
    if (!code?.trim() || !code.endsWith('\n') || code.includes('\r')) {
      throw new Error(`Missing complete LF-terminated C# example file: ${path}`)
    }
    return code
  }
  const urlFor = (path: string) => `https://github.com/${source.repo}/blob/${source.revision}/${path}`
  const setup = [
    { sourceFile: 'global.json', path: 'global.json', lang: 'json' },
    { sourceFile: 'examples/api/NuGet.config', path: 'NuGet.config', lang: 'xml' },
    { sourceFile: profile.projectFile, path: 'Example.csproj', lang: 'xml' },
  ]
  const sdk = JSON.parse(codeFor('global.json')).sdk?.version
  if (!/^\d+\.\d+\.\d+$/.test(sdk ?? '')) throw new Error('C# examples require a pinned SDK')
  const ids = new Set<string>()
  for (const program of programs) {
    if (!/^csharp-[A-Za-z0-9]+$/.test(program.id) || ids.has(program.id) ||
        typeof program.title !== 'string' || !program.title.trim() ||
        typeof program.description !== 'string' || !program.description.trim() ||
        !/^examples\/LibTmux\.Examples\/Programs\/[A-Za-z0-9]+\.cs$/.test(program.sourceFile) ||
        typeof program.output !== 'string' || !program.output.trim() ||
        !program.output.endsWith('\n') || program.output.includes('\r') ||
        !Array.isArray(program.targets) || !program.targets.length) {
      throw new Error(`Invalid C# example metadata: ${program.id}`)
    }
    ids.add(program.id)
    const blocks: NonNullable<DocBlock['examples']> = [{
      lang: 'console',
      intro: `${program.description.replace(/\n/g, ' ')} Use Linux or macOS with Git, tmux 3.2a or newer, .NET SDK ${sdk}, and the .NET 8 and 10 runtimes. In an empty directory, fetch the documented library revision:`,
      code: `$ git clone https://github.com/${source.repo}.git libtmux-source && \\\n  git -C libtmux-source checkout --detach ${source.revision}\n`,
    }]
    for (const file of setup) blocks.push({
      lang: file.lang, intro: `Save this complete consumer setup as ${file.path}:`,
      sourceUrl: urlFor(file.sourceFile), code: codeFor(file.sourceFile),
    })
    blocks.push({
      lang: 'csharp',
      intro: 'Save this complete program as Program.cs. It creates a private server; await using disposes its owned scopes after success, cancellation or failure. The complete file contains explicit imports, a top-level async entry point and a cancellation deadline.',
      sourceUrl: urlFor(program.sourceFile), code: codeFor(program.sourceFile),
    }, {
      lang: 'console',
      intro: 'Build the exact source package and the saved consumer, then run both supported frameworks. The local package feed prevents an unrelated published package from satisfying the restore. Each program checks its result and exits unsuccessfully after an unhandled error:',
      code: '$ export NUGET_PACKAGES="$PWD/packages" && \\\n' +
        '  dotnet restore libtmux-source/src/LibTmux/LibTmux.csproj --locked-mode && \\\n' +
        '  dotnet pack libtmux-source/src/LibTmux/LibTmux.csproj \\\n' +
        '    --configuration Release --no-restore -p:ContinuousIntegrationBuild=true \\\n' +
        '    --output "$PWD/libtmux-source/artifacts/api-example-packages" && \\\n' +
        '  dotnet restore Example.csproj --configfile NuGet.config && \\\n' +
        '  dotnet build Example.csproj --configuration Release --no-restore --warnaserror && \\\n' +
        '  export LIBTMUX_TMUX="$(command -v tmux)" && \\\n' +
        '  export TMUX_TMPDIR=/tmp/libtmux-dotnet-dev && \\\n' +
        '  mkdir -p "$TMUX_TMPDIR" && \\\n' +
        '  unset TMUX TMUX_PANE && \\\n' +
        '  dotnet bin/Release/net8.0/Example.dll && \\\n' +
        '  dotnet bin/Release/net10.0/Example.dll\n',
    }, { lang: 'text', intro: 'Expected program output from each framework:', code: program.output })
    const targets = new Set<string>()
    const pages = new Set<ApiSymbol>()
    for (const target of program.targets) {
      // Source validation proves full compiler IDs. The site groups native overloads by name.
      if (typeof target !== 'string' || !/^[MPT]:LibTmux\.[\w.`]+(?:\([^()\s]+\))?$/.test(target)) {
        throw new Error(`Invalid C# compiler target: ${target}`)
      }
      if (targets.has(target)) throw new Error(`Duplicate C# compiler target: ${target}`)
      targets.add(target)
      const id = target.slice(2).replace(/\(.*$/, '').replace(/`{1,2}\d+/g, '')
      const matches = symbols.filter((symbol) => symbol.id === id)
      const kinds = target.startsWith('M:') ? ['method'] : target.startsWith('P:')
        ? ['property'] : ['class', 'interface', 'struct', 'enum']
      if (matches.length !== 1 || !kinds.includes(matches[0].kind)) {
        throw new Error(`C# example target must resolve once with its native kind: ${target}`)
      }
      pages.add(matches[0])
    }
    for (const symbol of pages) {
      symbol.doc = { summary: '', ...symbol.doc, examples: [...(symbol.doc?.examples ?? []), ...blocks] }
    }
  }
}
