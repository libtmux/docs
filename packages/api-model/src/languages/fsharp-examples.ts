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

/**
 * Attach source-verified compiler targets without changing the site's F# source identities.
 *
 * The consumer project references the NuGet release its repository revision
 * declares, so readers restore it from nuget.org; the port's local package
 * feed and pinned SDK serve only its own source-built verification.
 */
export function attachCompleteFSharpExamples(
  symbols: ApiSymbol[],
  read: (path: string) => string | undefined,
  source: { repo: string; revision: string },
): void {
  const raw = read('examples/api/manifest.json')
  if (raw === undefined) return
  const manifest = JSON.parse(raw) as Manifest
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.examples) || !manifest.examples.length ||
      JSON.stringify(manifest.setupFiles) !== JSON.stringify(['global.json', 'examples/api/NuGet.config'])) {
    throw new Error('Invalid F# example manifest')
  }
  const profile = manifest.profiles?.fsharp
  if (profile?.package !== 'LibTmux.FSharp' || profile.projectFile !== 'examples/api/fsharp/Example.fsproj' ||
      profile.entrypoint !== 'Program.fs') throw new Error('Invalid F# example profile')
  if (source.repo !== 'libtmux/libtmux-dotnet' || !/^[0-9a-f]{40}$/.test(source.revision)) {
    throw new Error('F# examples require the public repository and full source revision')
  }
  const codeFor = (path: string): string => {
    if (path !== 'global.json' && !/^examples\/(?:[\w.-]+\/)*[\w.-]+$/.test(path) || path.split('/').includes('..')) {
      throw new Error(`Invalid F# example source path: ${path}`)
    }
    const code = read(path)
    if (!code?.trim() || !code.endsWith('\n') || code.includes('\r')) {
      throw new Error(`Missing complete LF-terminated F# example file: ${path}`)
    }
    return code
  }
  const urlFor = (path: string) => `https://github.com/${source.repo}/blob/${source.revision}/${path}`
  const sdk = JSON.parse(codeFor('global.json')).sdk?.version
  if (!/^\d+\.\d+\.\d+$/.test(sdk ?? '')) throw new Error('F# examples require a pinned SDK')
  const project = codeFor(profile.projectFile)
  const release = new RegExp(`<PackageReference Include="${profile.package.replaceAll('.', '\\.')}" Version="\\[([^\\]]+)\\]" />`)
    .exec(project)?.[1]
  if (!release) throw new Error(`F# example project must reference one exact ${profile.package} release`)
  const ids = new Set<string>()
  for (const program of manifest.examples) {
    if (program.profile !== 'fsharp') continue
    if (!/^fsharp-[A-Za-z0-9]+$/.test(program.id) || ids.has(program.id) ||
        typeof program.title !== 'string' || !program.title.trim() ||
        typeof program.description !== 'string' || !program.description.trim() ||
        !/^examples\/LibTmux\.FSharp\.Examples\/Programs\/[A-Za-z0-9]+\.fs$/.test(program.sourceFile) ||
        typeof program.output !== 'string' || !program.output.trim() ||
        !program.output.endsWith('\n') || program.output.includes('\r') ||
        !Array.isArray(program.targets) || !program.targets.length) {
      throw new Error(`Invalid F# example metadata: ${program.id}`)
    }
    ids.add(program.id)
    const blocks: NonNullable<DocBlock['examples']> = [{
      lang: 'xml',
      intro: `${program.description.replace(/\n/g, ' ')} Use Linux or macOS with tmux 3.3a or newer, the .NET ${sdk.split('.')[0]} SDK or newer, and the .NET 8 and 10 runtimes. In an empty directory, save this project as \`Example.fsproj\`. It references the ${release} release of \`${profile.package}\` on NuGet:`,
      sourceUrl: urlFor(profile.projectFile), code: project,
    }]
    blocks.push({
      lang: 'fsharp',
      intro: 'Save this complete program as `Program.fs`. It creates a private server with `LibTmux.Server.CreateOwnedAsync`; `use!` disposes owned scopes after success, cancellation or failure. The F# facade has no separate server constructor.',
      sourceUrl: urlFor(program.sourceFile), code: codeFor(program.sourceFile),
    }, {
      lang: 'console',
      intro: 'Build the project and run both supported frameworks. Each program checks its result and exits unsuccessfully after an unhandled error:',
      code: '$ dotnet build Example.fsproj --configuration Release && \\\n' +
        '  dotnet bin/Release/net8.0/Example.dll && \\\n' +
        '  dotnet bin/Release/net10.0/Example.dll\n',
    }, { lang: 'text', intro: 'Expected program output from each framework:', code: program.output })
    const targets = new Set<string>()
    for (const target of program.targets) {
      // XML documentation addresses include kind, generic arity and parameter metadata.
      // Source manifests verify the full compiler ID; the site preserves F# source names.
      if (typeof target !== 'string' || !/^[MT]:LibTmux\.FSharp\.[\w.]+(?:`{1,2}\d+)?(?:\([^()\s]+\))?$/.test(target)) {
        throw new Error(`Invalid F# compiler target: ${target}`)
      }
      const id = target.slice(2).replace(/\(.*$/, '').replace(/`{1,2}\d+$/, '')
      if (targets.has(id)) throw new Error(`Duplicate F# example target: ${target}`)
      const matches = symbols.filter((symbol) => symbol.id === id)
      if (matches.length !== 1 || (target.startsWith('M:')
        ? !['function', 'method'].includes(matches[0].kind)
        : !['module', 'class', 'struct', 'enum', 'typealias'].includes(matches[0].kind))) {
        throw new Error(`F# example target must resolve once with its native kind: ${target}`)
      }
      targets.add(id)
      const symbol = matches[0]
      symbol.doc = { summary: '', ...symbol.doc, examples: [...(symbol.doc?.examples ?? []), ...blocks] }
    }
  }
}
