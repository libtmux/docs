import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import { extractPython } from './languages/python.ts'
import { extractDoxygen } from './languages/doxygen.ts'
import { extractSymbolGraph } from './languages/symbolgraph.ts'
import { extractWithSpec } from './languages/spec.ts'
import { SPECS } from './languages/specs.ts'
import { resolvePublicIds } from './reexports.ts'
import {
  DEFAULT_EXTRACT_OPTIONS,
  type ApiModel,
  type ApiSymbol,
  type ExtractOptions,
  type PortSlug,
} from './model.ts'

/**
 * Whole-tree extraction, and the pass that makes coverage complete.
 *
 * A per-file extractor finds what a file declares. autodoc renders what an
 * imported object *has*, which is a different and larger set: `Pane` declares
 * 56 members and presents 251, because 198 dataclass fields arrive from `Obj`
 * in another module. Closing that needs no type checker — it needs every file
 * in one symbol table and a walk up the base-class chain by name.
 *
 * That mechanism generalises past Python. Rust attaches members to a type
 * through `impl` blocks in other files; Swift does it with extensions; C#
 * with partial classes. All of them are "resolve a name against the table
 * this pass builds", not "infer a type".
 */

/**
 * One symbol per id, merging declarations that the language considers one.
 *
 * Only C# reaches this with anything to do: a `partial class` is a single type
 * the compiler assembles from several files, and each file yields its own
 * type-level symbol with the same id. `partial` methods do the same, declaring
 * in one part and implementing in another.
 *
 * A no-op everywhere else, and measurably so — the other seven ports produce
 * zero duplicate ids, and this is the assertion that keeps it that way rather
 * than a transformation applied on faith.
 *
 * The kept declaration is the documented one. C# convention puts the class
 * summary on the part named after the type (`Pane.cs`) and leaves the feature
 * parts (`Pane.Topology.cs`) undocumented, so preferring a summary usually
 * picks that part; `extends` and `modifiers` are unioned because a partial
 * declaration may name a base or an interface in any part.
 */
function mergePartials(symbols: ApiSymbol[]): ApiSymbol[] {
  const byId = new Map<string, ApiSymbol>()
  const out: ApiSymbol[] = []
  for (const s of symbols) {
    const seen = byId.get(s.id)
    if (!seen) {
      byId.set(s.id, s)
      out.push(s)
      continue
    }
    const union = (a?: string[], b?: string[]) =>
      a || b ? [...new Set([...(a ?? []), ...(b ?? [])])] : undefined
    seen.extends = union(seen.extends, s.extends)
    seen.modifiers = union(seen.modifiers, s.modifiers) as ApiSymbol['modifiers']

    // Two parts declaring the same method name is an overload set, not a
    // repeat — `spec.ts` already says so for two declarations in one file, and
    // a `partial class` is one scope however many files it is written across.
    // Keeping only the first signature would drop the others invisibly.
    const fresh = s.signatures.filter(
      (sig) => !seen.signatures.some((k) => k.params.length === sig.params.length &&
        k.params.every((p, i) => p.type === sig.params[i]?.type)),
    )
    if (fresh.length) {
      seen.signatures.push(...fresh)
      if (!seen.modifiers?.includes('overload')) {
        seen.modifiers = [...(seen.modifiers ?? []), 'overload']
      }
    }

    // A part with prose beats a part without, whichever arrived first.
    if (!seen.doc?.summary && s.doc?.summary) {
      seen.doc = s.doc
      seen.source = s.source
    }
  }
  return out
}

/**
 * Source layout per port: where the public API lives, and what to skip.
 *
 * Test files are excluded by pattern rather than by directory, because the
 * eight ports put them in four different places — `_test.go` beside the
 * source, `src/test/java`, `*.test.ts`, and a sibling `Tests/` project.
 */
const LAYOUT: Record<
  string,
  { ext: string; skip: RegExp; moduleFrom?: 'file' | 'dir' | 'namespace' }
> = {
  py: { ext: 'py', skip: /(^|\/)(tests?|conftest)\b|_test\.py$|^test_/ },
  ts: { ext: 'ts', skip: /\.test\.ts$|\.spec\.ts$|(^|\/)__tests__\// },
  rs: { ext: 'rs', skip: /(^|\/)tests?\// },
  // Go's namespace is the package *directory*, not the file: `Window` in
  // model.go and its methods in hierarchy.go belong together. Deriving the
  // module per file gave three different "modules" for one package and left
  // every method unable to find its type.
  go: { ext: 'go', skip: /_test\.go$/, moduleFrom: 'dir' },
  java: { ext: 'java', skip: /(^|\/)test(s)?(\/|$)/i },
  // C# says where a type lives, and it is not the file name. `Pane` is one
  // `partial class` split across `Pane.cs`, `Pane.Capture.cs`,
  // `Pane.Topology.cs` and nine more, all in namespace `LibTmux`. Deriving the
  // module from the file made twelve types called `Pane`, none of them the
  // real one, and scattered its members across twelve pages.
  //
  // Go above has the same defect from the opposite direction: one package
  // written across three files became three modules, where here one class
  // written across twelve files became twelve types. Both say a file is not
  // the unit of naming. C# is the easier of the two, because it states the
  // unit in line 1 of every file.
  dotnet: { ext: 'cs', skip: /(^|\/)(obj|bin)\/|Tests?\.cs$/, moduleFrom: 'namespace' },
}

/**
 * The namespace a C# file declares, which is the module its types belong to.
 *
 * All 296 declarations in libtmux-dotnet are file-scoped (`namespace X;`) and
 * none is block-scoped, so the first one in the file is the only one. A file
 * with no declaration at all — `GlobalUsings.cs` and friends — falls back to
 * the file name, which is what every other port does.
 *
 * Read rather than parsed: this runs before the grammar is loaded, and the
 * declaration is a single line the C# spec requires to precede every type.
 */
const NAMESPACE = /^\s*namespace\s+([A-Za-z_][\w.]*)\s*[;{]/m

function declaredNamespace(file: string): string | undefined {
  return NAMESPACE.exec(readFileSync(file, 'utf8'))?.[1]
}

/**
 * Source files a port publishes, with the module name each maps to.
 *
 * Sorted by module name, deliberately: the public-id tie-break depends on a
 * deterministic order, and a filesystem's directory order is not one.
 */
function sourceFiles(root: string, port: string): { file: string; module: string }[] {
  const layout = LAYOUT[port]
  if (!layout) throw new Error(`api-model: no source layout for port "${port}"`)
  const out: { file: string; module: string }[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === '__pycache__' || entry === 'node_modules' || entry === 'target') continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.endsWith(`.${layout.ext}`)) continue
      const rel = relative(root, full)
      if (layout.skip.test(rel)) continue
      const stem =
        layout.moduleFrom === 'dir'
          ? relative(root, dir) || basename(root)
          : layout.moduleFrom === 'namespace'
            ? (declaredNamespace(full) ?? rel.replace(new RegExp(`\\.${layout.ext}$`), ''))
            : rel.replace(new RegExp(`\\.${layout.ext}$`), '')
      const module = stem
        .split(sep)
        .filter((p) => p && p !== '.' && p !== '__init__' && p !== 'index' && p !== 'mod' && p !== 'lib')
        .join('.')
      out.push({ file: full, module: module || basename(root) || 'package' })
    }
  }
  walk(root)
  return out.sort((a, b) => a.module.localeCompare(b.module))
}

/**
 * Copy inherited members onto every subclass.
 *
 * Depth-first with a visited set, because a diamond (two bases sharing a base)
 * would otherwise copy the shared members twice, and a cycle — which invalid
 * source can express — would not terminate. Python's real MRO is C3
 * linearisation; this is the subset of it that matters for documentation,
 * where the question is "does this name reach here" rather than "which
 * implementation wins".
 *
 * A member declared on the subclass always beats an inherited one, which is
 * both what Python does and what a reader expects: an override should render
 * its own docstring, not its parent's.
 */
function resolveInheritance(symbols: ApiSymbol[], stopList: string[]): ApiSymbol[] {
  const byId = new Map(symbols.map((s) => [s.id, s]));
  // Classes are addressable by bare name as well as by id: a base is written
  // `class Pane(Obj)`, not `class Pane(libtmux.neo.Obj)`.
  const byName = new Map<string, ApiSymbol>()
  for (const s of symbols) {
    if (s.kind === 'class' || s.kind === 'exception' || s.kind === 'enum') {
      if (!byName.has(s.name)) byName.set(s.name, s)
    }
  }

  const membersOf = new Map<string, ApiSymbol[]>()
  for (const s of symbols) {
    if (!s.parent) continue
    const list = membersOf.get(s.parent) ?? []
    list.push(s)
    membersOf.set(s.parent, list)
  }

  const stop = new Set(stopList)
  const resolved = new Map<string, ApiSymbol[]>()
  const inProgress = new Set<string>()

  const inherited = (cls: ApiSymbol): ApiSymbol[] => {
    const cached = resolved.get(cls.id)
    if (cached) return cached
    if (inProgress.has(cls.id)) return []
    inProgress.add(cls.id)

    const own = membersOf.get(cls.id) ?? []
    const seen = new Set(own.map((m) => m.name))
    const out: ApiSymbol[] = []

    for (const base of cls.extends ?? []) {
      // `Obj` from `class Pane(Obj)`, `Generic` from `Generic[T]`.
      const baseName = base.replace(/\[.*$/, '').split('.').pop()?.trim() ?? ''
      if (!baseName || stop.has(baseName)) continue
      const baseSym = byName.get(baseName) ?? byId.get(base)
      if (!baseSym) continue
      for (const member of [...(membersOf.get(baseSym.id) ?? []), ...inherited(baseSym)]) {
        if (seen.has(member.name)) continue
        seen.add(member.name)
        out.push({
          ...member,
          id: `${cls.id}.${member.name}`,
          parent: cls.id,
          inheritedFrom: member.inheritedFrom ?? baseSym.id,
        })
      }
    }

    inProgress.delete(cls.id)
    resolved.set(cls.id, out)
    return out
  }

  const extra: ApiSymbol[] = []
  for (const s of symbols) {
    if (s.kind === 'class' || s.kind === 'exception') extra.push(...inherited(s))
  }
  return [...symbols, ...extra]
}

/** Extract one port's whole source tree into a model. */
/**
 * Members whose declared owner is not in the model.
 *
 * Two causes, and they are opposite. In Go an exported method can hang off an
 * unexported type — `func (b *controlLockedBuffer) Write(...)` — and the
 * visibility filter correctly drops the type while the method survives. That
 * is not public API: a caller can never hold the receiver.
 *
 * The other is an extension on a type the library does not own, like Swift's
 * `Sequence.exactlyOne(_:)`. That *is* public API, and dropping it would lose
 * a method callers can use on any sequence. It is re-parented to the top
 * level instead, keeping its qualified name, so it renders on the port index
 * rather than on a page for a type that is not ours.
 *
 * Left alone both render nowhere while the symbol index still links them —
 * 22 anchors to fragments that were never emitted, which is how they were
 * found. Applied on every extractor's output, not just the tree-sitter one:
 * Swift and C++ return early and the first version of this missed them.
 */
function rehomeOrphans(symbols: ApiSymbol[]): ApiSymbol[] {
  const present = new Set(symbols.map((s) => s.id))
  return symbols.flatMap((sym) => {
    if (!sym.parent || present.has(sym.parent)) return [sym]
    // Unexported by the port's own convention: Go and Rust spell it with a
    // lower-case initial, and a member of something private is private.
    const ownerName = sym.parent.split(/[.:]+/).pop() ?? ''
    if (/^[a-z_]/.test(ownerName)) return []
    return [{ ...sym, parent: undefined }]
  })
}

export async function extractProject(opts: {
  port: PortSlug
  root: string
  /** Additional package roots; `root` is used when omitted. */
  roots?: string[]
  revision?: string
  options?: ExtractOptions
}): Promise<ApiModel> {
  const options = { ...DEFAULT_EXTRACT_OPTIONS, ...opts.options }

  // Two ports do not come through tree-sitter, and arrive already resolved.
  if (opts.port === 'cxx') {
    return {
      port: opts.port,
      revision: opts.revision,
      extractor: '@libtmux/api-model@0.0.1 (doxygen)',
      symbols: rehomeOrphans(extractDoxygen(join(opts.root, 'xml'), opts.root)),
    }
  }
  if (opts.port === 'swift') {
    const dir = join(opts.root, 'symbolgraph')
    // `swift build -emit-symbol-graph` emits one graph per module in the
    // build, dependencies included — Subprocess and SystemPackage among them.
    // Those are somebody else's API and must not appear in this reference.
    const OWN = /^(LibTmux|TmuxWorkspace|TmuxFixture|libtmux)/
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.symbols.json') && OWN.test(f))
      .map((f) => join(dir, f))
      .sort()
    return {
      port: opts.port,
      revision: opts.revision,
      extractor: '@libtmux/api-model@0.0.1 (swift symbol graph)',
      symbols: rehomeOrphans(extractSymbolGraph(files)),
    }
  }

  const spec = SPECS[opts.port as keyof typeof SPECS]
  if (opts.port !== 'py' && !spec) {
    // C++ and Swift do not come through tree-sitter: their grammars lose 0.34%
    // and 2.84% of the real trees, and what they lose — a default argument,
    // a typed throws clause — is exactly what a reference exists to show.
    // See docs/DESIGN.md; those two arrive from Doxygen XML and
    // `swift -emit-symbol-graph` instead.
    throw new Error(`api-model: port "${opts.port}" is not extracted with tree-sitter`)
  }

  // A port is not one package. Rust ships `libtmux` plus `tmux-workspace`,
  // TypeScript `libtmux` plus `workspace`, Java seven modules — and extracting
  // only the core left `workspace.Build` and `tmuxq.Where` unresolvable
  // because they were never in the model at all.
  const roots = opts.roots ?? [opts.root]
  const modules = roots.flatMap((r) => sourceFiles(r, opts.port))
  const symbols: ApiSymbol[] = []
  for (const { file, module } of modules) {
    symbols.push(
      ...(opts.port === 'py'
        ? await extractPython(file, module, options)
        : await extractWithSpec(spec, file, module, options)),
    )
  }

  // Before inheritance, so a base class is one type rather than several.
  const merged = mergePartials(symbols)

  const resolved = options.inheritedMembers
    ? resolveInheritance(merged, options.inheritanceStopList)
    : merged
  // Public paths last: inherited members need their owner to exist first, and
  // an inherited member's public path comes from the class it landed on, not
  // from the base it was declared in. Only Python re-exports through
  // `__init__.py`; the others carry their public path in the declaration.
  const withPublic = await resolvePublicIds(
    resolved,
    modules.filter((m) => m.file.endsWith('__init__.py')),
  )

  // Pruning happens after public ids resolve: the rule names the path a
  // consumer would import by, which is `publicId`, not the declaration path.
  const rules = options.excludePaths
  const kept = rules.length
    ? withPublic.filter((s) => !rules.some((re) => re.test(s.publicId ?? s.id)))
    : withPublic
  const owned = rehomeOrphans(kept)

  return {
    port: opts.port,
    revision: opts.revision,
    extractor: '@libtmux/api-model@0.0.1',
    symbols: owned,
    pruned: rules.length
      ? {
          dropped: withPublic.length - owned.length,
          kept: owned.length,
          rules: rules.map(String),
        }
      : undefined,
  }
}
