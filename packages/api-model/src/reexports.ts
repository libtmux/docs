import { readFileSync } from 'node:fs'
import type { Node } from 'web-tree-sitter'
import type { ApiSymbol } from './model.ts'
import { parserFor } from './parser.ts'

/**
 * Public names, which are the ones everything else uses.
 *
 * `Pane` is defined in `libtmux/pane.py`, so its declaration id is
 * `libtmux.pane.Pane`. Nobody writes that. `libtmux/__init__.py` re-exports it,
 * so the import is `from libtmux import Pane`, the docstring role is
 * `` :class:`~libtmux.Pane` ``, and the anchor gp-sphinx emits — the one
 * readers have bookmarked and the one every prose page links — is
 * `libtmux.Pane.capture_pane`.
 *
 * Anchors and cross-references therefore render from `publicId`, not `id`.
 * Getting this wrong would not break the build; it would produce a reference
 * whose every link is subtly wrong, which is worse.
 */

/** `from .pane import Pane` and `from libtmux.pane import Pane` alike. */
function importedNames(root: Node, module: string): Map<string, string> {
  const out = new Map<string, string>()
  const pkg = module.replace(/\.[^.]+$/, '') || module

  for (const stmt of root.namedChildren) {
    if (stmt?.type !== 'import_from_statement') continue
    const from = stmt.childForFieldName('module_name')
    if (!from) continue
    // `.pane` is relative to this module's package; `libtmux.pane` is absolute.
    const raw = from.text
    const source = raw.startsWith('.') ? `${pkg}${raw}` : raw

    for (const child of stmt.namedChildren) {
      if (!child || child === from) continue
      if (child.type === 'dotted_name' || child.type === 'identifier') {
        out.set(child.text, `${source}.${child.text}`)
      } else if (child.type === 'aliased_import') {
        const name = child.childForFieldName('name')?.text
        const alias = child.childForFieldName('alias')?.text
        if (name && alias) out.set(alias, `${source}.${name}`)
      }
    }
  }
  return out
}

/** The string literals inside `__all__ = (...)`, when a module declares one. */
function dunderAll(root: Node): Set<string> | undefined {
  for (const stmt of root.namedChildren) {
    if (stmt?.type !== 'expression_statement') continue
    const assign = stmt.namedChild(0)
    if (assign?.type !== 'assignment') continue
    if (assign.childForFieldName('left')?.text !== '__all__') continue
    const right = assign.childForFieldName('right')
    if (!right) continue
    const names = new Set<string>()
    for (const item of right.namedChildren) {
      if (item?.type === 'string') names.add(item.text.replace(/^['"]|['"]$/g, ''))
    }
    return names
  }
  return undefined
}

/**
 * Give every symbol the shortest path it can be reached by.
 *
 * Shortest wins because that is what people write and what autodoc anchors:
 * `libtmux.Pane` beats `libtmux.pane.Pane`. Members inherit their owner's
 * public path, so `capture_pane` becomes `libtmux.Pane.capture_pane` without
 * `__init__.py` having to mention it.
 */
export async function resolvePublicIds(
  symbols: ApiSymbol[],
  initFiles: { file: string; module: string }[],
): Promise<ApiSymbol[]> {
  const parser = await parserFor('python')
  /** declaration id -> shortest public id */
  const publicOf = new Map<string, string>()

  for (const { file, module } of initFiles) {
    const tree = parser.parse(readFileSync(file, 'utf8'))
    if (!tree) continue
    const imported = importedNames(tree.rootNode, module)
    const exported = dunderAll(tree.rootNode)

    for (const [local, declared] of imported) {
      // A module with `__all__` publishes exactly that list. Without one,
      // every imported name is reachable — which is Python's rule, not a
      // guess, and it matches what autodoc will document.
      if (exported && !exported.has(local)) continue
      const candidate = `${module}.${local}`
      const existing = publicOf.get(declared)
      // Shortest wins, and ties break lexicographically rather than by
      // whichever `__init__.py` was read first.
      //
      // This matters more than a tidy-up: `publicId` is the anchor and the
      // permalink. An order-dependent tie means adding an unrelated module
      // could silently move an existing symbol's anchor and break every
      // bookmark to it, with nothing failing. The iteration order happens to
      // be stable today because `pythonModules()` sorts — but that guarantee
      // lives in another file and nothing states the dependency.
      if (!existing || candidate.length < existing.length) {
        publicOf.set(declared, candidate)
      } else if (candidate.length === existing.length && candidate < existing) {
        publicOf.set(declared, candidate)
      }
    }
  }

  // Owners first, then members, so a member can read its owner's public path.
  const byId = new Map(symbols.map((s) => [s.id, s]))
  const resolve = (sym: ApiSymbol): string => {
    const direct = publicOf.get(sym.id)
    if (direct) return direct
    if (!sym.parent) return sym.id
    const owner = byId.get(sym.parent)
    if (!owner) return sym.id
    return `${resolve(owner)}.${sym.name}`
  }

  return symbols.map((s) => ({ ...s, publicId: resolve(s) }))
}
