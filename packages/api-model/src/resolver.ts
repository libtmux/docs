import type { ApiModel, ApiSymbol } from './model.ts'
import type { InventoryEntry } from './inventory.ts'
import { modulesIn } from './modules.ts'

/**
 * One resolver for every place a symbol is mentioned: a prose table cell, a
 * doc-comment role, a type annotation.
 *
 * The design is the one four rounds of spikes converged on
 * (`.git/spike/cross-language-interlinking.md`), and two of its rules exist
 * because a more obvious alternative was measured and lost:
 *
 * - **Tail-first.** Resolve the last segment, then scope by the one before it.
 *   Walking the path from the head scored 46% against tail-first's 66% on the
 *   same corpus, because prose receivers are conventional stand-ins
 *   (`server`, `session`, `snapshot`) and not expressions to evaluate.
 *   Chain-following survives only as a fallback, where it adds 12 more.
 * - **No column headers.** Using a table's column header as a scope resolved
 *   exactly zero, and structurally: columns whose header names a type hold
 *   cells that already carry a receiver, and cells lacking one sit under
 *   semantic headers ("Exactly-one", "Empty"). Do not retry this.
 */

export type Resolution =
  | { how: 'unique' | 'scoped' | 'chained' | 'module'; symbol: ApiSymbol; port: string }
  | { how: 'module-index'; module: string; port: string }
  | { how: 'federated'; href: string; project: string }
  | { how: 'ambiguous'; candidates: number }
  | { how: 'no-symbol' }
  | { how: 'not-a-symbol'; why: string }

/** Kinds that can own members, and therefore act as a scope. */
const TYPE_KINDS = new Set(['class', 'struct', 'interface', 'enum', 'trait', 'exception'])

/**
 * Ecosystems with no `objects.inv` to federate against.
 *
 * Sphinx projects publish inventories; javadoc and pkg.go.dev do not. Their
 * URLs are derivable from the qualified name instead — the same federation
 * idea with a template where a file would be. Naming that difference beats
 * pretending an inventory exists.
 */
export interface UrlTemplate {
  project: string
  prefixes: string[]
  href: (qualified: string) => string
  /**
   * Ports this template answers for. Omitted means every port, which is
   * almost never what a language's standard library wants: unscoped, the Go
   * template claimed `time.sleep()` in Python prose and the Java one claimed
   * `Stream.filter()`.
   */
  langs?: string[]
}

/**
 * The package a port's prose means when it does not say.
 *
 * Every port ships several: Rust has `libtmux` plus `tmux-workspace`, Go
 * `tmux` plus `tmuxq` and `workspace`. The core one is where an unqualified
 * `Window` comes from.
 */
export const DEFAULT_PRIMARY_MODULES: Record<string, string> = {
  py: 'libtmux',
  ts: 'libtmux',
  rs: 'libtmux',
  go: 'tmux',
  java: 'io.github.libtmux',
  dotnet: 'LibTmux',
  cxx: 'libtmux',
  swift: 'LibTmux',
}

export const DEFAULT_TEMPLATES: UrlTemplate[] = [
  {
    project: 'Go standard library',
    langs: ['go'],
    prefixes: ['errors.', 'context.', 'fmt.', 'io.', 'os.', 'time.', 'sync.', 'strings.'],
    href: (q) => {
      const i = q.indexOf('.')
      return 'https://pkg.go.dev/' + q.slice(0, i) + '#' + q.slice(i + 1)
    },
  },
  {
    project: 'Java SE',
    langs: ['java'],
    prefixes: ['Stream.', 'Optional.', 'List.', 'Map.', 'Set.', 'CompletableFuture.'],
    href: (q) =>
      'https://docs.oracle.com/en/java/javase/21/docs/api/index.html?q=' + encodeURIComponent(q),
  },
]

/**
 * Text that looks like a call but is not a symbol reference.
 *
 * Excluding these gained three points where the cleverest idea tried in the
 * spikes gained zero. A denominator full of things that can never resolve
 * makes a resolver look worse than it is and hides the failures that matter.
 */
export function notASymbol(text: string): string | undefined {
  if (/\.(py|ts|go|rs|java|cs|cpp|hpp|swift|md|json|toml|sh)\b/.test(text)) return 'a filename'
  if (/(^|\s)--?[A-Za-z]/.test(text)) return 'a command-line flag'
  if (/[=<>!]=|\s[=<>]\s/.test(text)) return 'an expression, not a reference'
  if (/^new\s/.test(text)) return 'a constructor call'
  if (/^\.{3}/.test(text)) return 'an ellipsis'
  if (/\{[^}]*:/.test(text)) return 'a struct or object literal'
  return undefined
}

/** Strip call syntax down to a dotted path. */
export function toPath(text: string): string[] {
  return text
    .replace(/^(await|try|new)\s+/, '')
    .replace(/\(.*$/, '')
    .replace(/->/g, '.')
    .replace(/::/g, '.')
    .replace(/\s+/g, '')
    .split('.')
    .filter(Boolean)
}

interface Row {
  port: string
  symbol: ApiSymbol
  qualified: string
}

export class Resolver {
  private readonly byMember = new Map<string, Row[]>()
  private readonly byQualified = new Map<string, Row>()
  /**
   * Module names per port: key `port dotted-name`, value the name as written.
   *
   * Two forms because the lookup and the destination want different ones.
   * `toPath` normalises every separator to a dot, so C++'s `libtmux::test`
   * arrives as `libtmux.test` and has to be found under that key — but the
   * anchor on the port index is the name the language actually writes.
   */
  private readonly modules = new Map<string, string>()
  private readonly inventories: {
    project: string
    baseUrl: string
    entries: Map<string, InventoryEntry>
    langs?: string[]
  }[] = []
  private readonly templates: UrlTemplate[]

  /**
   * Modules whose symbols win a tie, per port.
   *
   * Extracting every public package — which the reference needs — introduced
   * ambiguity the single-package model never had: `workspace.Window` and
   * `tmux.Window` both exist, so `window.Panes` scopes to two owners and
   * resolution correctly refuses. But prose in a core guide means the core
   * type, and saying which module is primary is a fact about the project
   * rather than a guess about the sentence.
   */
  private readonly primary: Record<string, string>

  constructor(
    models: ApiModel[],
    templates: UrlTemplate[] = DEFAULT_TEMPLATES,
    primaryModules: Record<string, string> = DEFAULT_PRIMARY_MODULES,
  ) {
    this.templates = templates
    this.primary = primaryModules
    for (const model of models) {
      // Exactly the modules the port index renders a section for. Deriving
      // both from one function is what keeps a resolvable module and an
      // existing anchor the same thing: registering enclosing prefixes once
      // gave `libtmux._internal` a resolution and nothing to land on.
      for (const mod of modulesIn(model)) {
        this.modules.set(model.port + ' ' + mod.name.replace(/::/g, '.'), mod.name)
      }
      for (const symbol of model.symbols) {
        const qualified = symbol.publicId ?? symbol.id
        const row: Row = { port: model.port, symbol, qualified }
        // Swift's symbol graph names a method by its full selector —
        // `unsetEnvironment(_:in:)` — so prose saying `unsetEnvironment`
        // matched nothing at all. Index both forms: the labelled name is what
        // the reference displays, the bare one is what a sentence writes.
        for (const key of new Set([symbol.name, symbol.name.replace(/\(.*$/, '')])) {
          if (!key) continue
          const list = this.byMember.get(key) ?? []
          list.push(row)
          this.byMember.set(key, list)
        }
        this.byQualified.set(model.port + ' ' + qualified, row)

      }
    }
  }

  /**
   * Attach an inventory, scoped to the ports it actually describes.
   *
   * See `SymbolIndex.addInventory` for why the scope is mandatory in spirit:
   * an unscoped CPython inventory answered for all eight ports.
   */
  addInventory(
    project: string,
    baseUrl: string,
    entries: InventoryEntry[],
    langs?: string[],
  ): void {
    const map = new Map<string, InventoryEntry>()
    for (const e of entries) if (!map.has(e.name)) map.set(e.name, e)
    this.inventories.push({ project, baseUrl: baseUrl.replace(/\/*$/, '/'), entries: map, langs })
  }

  private members(port: string, name: string): Row[] {
    return (this.byMember.get(name) ?? []).filter((r) => r.port === port)
  }

  /**
   * Drop a type's own constructor when the type itself is a candidate.
   *
   * C++, C# and Java all name a constructor after its class, so `Window`
   * matched both `libtmux::Window` and `libtmux::Window::Window`, and the
   * resolver refused a name that is not actually ambiguous. Twenty-five of
   * thirty-three ambiguities were a type losing to itself.
   *
   * The test is structural rather than a kind check: among candidates that
   * all share one name, a member whose parent is a candidate type *is* that
   * type's constructor. Members of an unrelated type keep their claim, so
   * genuinely contested names — Go's `OpenNotifications` on two receivers,
   * Rust's three `Error` types — still refuse.
   */
  private static preferTypeOverConstructor(rows: Row[]): Row[] {
    const types = new Set(
      rows.filter((r) => TYPE_KINDS.has(r.symbol.kind)).map((r) => r.symbol.id),
    )
    if (!types.size) return rows
    const kept = rows.filter((r) => !r.symbol.parent || !types.has(r.symbol.parent))
    return kept.length ? kept : rows
  }

  /** Resolve one mention within one port. */
  resolve(port: string, text: string): Resolution {
    const why = notASymbol(text)
    if (why) return { how: 'not-a-symbol', why }

    const parts = toPath(text)
    if (!parts.length) return { how: 'not-a-symbol', why: 'empty after normalisation' }

    // A fully qualified name wins outright. `tmux.NewServer` is the module
    // path a Go reader writes, not a receiver, and treating it as one was the
    // single largest remaining failure.
    const whole = this.byQualified.get(port + ' ' + parts.join('.'))
    if (whole) return { how: 'module', symbol: whole.symbol, port }

    const member = parts[parts.length - 1]
    const local = Resolver.preferTypeOverConstructor(this.members(port, member))
    if (local.length === 1) return { how: 'unique', symbol: local[0].symbol, port }

    if (parts.length > 1) {
      const receiver = parts[parts.length - 2]
      // Prose names a variable after its type; both spellings occur.
      for (const cand of [receiver, receiver[0].toUpperCase() + receiver.slice(1)]) {
        const owners = this.members(port, cand).filter((r) => TYPE_KINDS.has(r.symbol.kind))
        const scoped = local.filter((r) => owners.some((o) => r.symbol.parent === o.symbol.id))
        if (scoped.length === 1) return { how: 'scoped', symbol: scoped[0].symbol, port }
        if (scoped.length > 1) {
          const prefix = this.primary[port]
          const preferred = prefix ? scoped.filter((r) => r.qualified.startsWith(prefix + '.')) : []
          if (preferred.length === 1) return { how: 'scoped', symbol: preferred[0].symbol, port }
        }
      }
      // Fallback: the receiver is a property whose declared type owns the member.
      for (const via of this.members(port, receiver)) {
        const declared = via.symbol.type ?? via.symbol.signatures[0]?.returns
        if (!declared) continue
        const bare = declared
          .replace(/[<[(].*$/, '')
          .replace(/[?!*&]/g, '')
          .split(/[.:]/)
          .pop()
          ?.trim()
        if (!bare) continue
        const owner = this.members(port, bare).find((r) => TYPE_KINDS.has(r.symbol.kind))
        if (!owner) continue
        const hit = local.filter((r) => r.symbol.parent === owner.symbol.id)
        if (hit.length === 1) return { how: 'chained', symbol: hit[0].symbol, port }
      }
    }

    const qualified = parts.join('.')

    // A module is not a symbol in any extractor's output, but prose names one
    // constantly — `libtmux.neo`, `LibTmux.Testing`, `libtmux::test`. It
    // resolves to that module's section on the port index, which is a real
    // destination rather than an approximation of one.
    //
    // Late, not early. docfx names a file after the member it documents, so
    // `Server.FromEnvironment` is both a method and, spuriously, a module
    // path; run first, this step claimed such names and sent a reader to a
    // module heading instead of the method they had just read about. A module
    // is what a name means when it means nothing more specific.
    const asModule = this.modules.get(port + ' ' + qualified)
    if (asModule) return { how: 'module-index', module: asModule, port }

    for (const inv of this.inventories) {
      if (inv.langs && !inv.langs.includes(port)) continue
      // The full dotted name only. A tail match here made Java's
      // `Stream.filter()` resolve to Python's builtin `filter` — a link that
      // is worse than no link, because it looks deliberate.
      const hit = inv.entries.get(qualified)
      if (hit) return { how: 'federated', href: inv.baseUrl + hit.uri, project: inv.project }
    }
    for (const t of this.templates) {
      if (t.langs && !t.langs.includes(port)) continue
      if (t.prefixes.some((p) => qualified.startsWith(p))) {
        return { how: 'federated', href: t.href(qualified), project: t.project }
      }
    }

    if (local.length > 1) return { how: 'ambiguous', candidates: local.length }
    return { how: 'no-symbol' }
  }

  /** Every port that declares a symbol of this name — the cross-port axis. */
  portsWith(name: string): string[] {
    return [...new Set((this.byMember.get(name) ?? []).map((r) => r.port))]
  }
}
