/**
 * Where a symbol name may be broken across lines.
 *
 * Swift spells a memberwise initialiser
 * `init(id:index:width:height:isActive:currentCommand:currentPath:isAtTop:…)`.
 * That is one word to a browser, so it either overflows its column or, with
 * `overflow-wrap: anywhere`, breaks at whatever character happens to sit at
 * the edge — `…isActive:curre` / `ntCommand:…`. Neither is readable, and
 * shortening it to `init()` is not an option: the argument labels *are* the
 * name in Swift, so `init(id:)` and `init(from:)` would collide.
 *
 * The rule and the pattern come from Apple's own documentation renderer —
 * `WordBreak.vue` in swift-docc-render — which inserts `<wbr>` at boundaries
 * a reader would choose:
 *
 *   between a lower and an upper case letter   fooBar    -> foo|Bar
 *   after a colon                              foo:bar   -> foo:|bar
 *   before a dot                               Foo.Bar   -> Foo|.Bar
 *   before an underscore                       foo_bar   -> foo|_bar
 *
 * It is not Swift-specific: `libtmux.Server.new_session` and
 * `TmuxCommandDispatcher` break the same way, and every port has names long
 * enough to need it.
 */

/** Apple's pattern, unchanged: swift-docc-render/src/components/WordBreak.vue */
const SAFE_BOUNDARY = /([a-z](?=[A-Z])|(:)\w|\w(?=[._]\w))/g

/**
 * `name` split at the points a `<wbr>` belongs between.
 *
 * Returns a single-element array when there is nowhere safe to break, so a
 * caller can render the parts joined by `<wbr>` without special-casing.
 */
export function wordBreak(name: string): string[] {
  const parts: string[] = []
  let last = 0
  let match: RegExpExecArray | null
  SAFE_BOUNDARY.lastIndex = 0
  while ((match = SAFE_BOUNDARY.exec(name)) !== null) {
    const next = match.index + 1
    parts.push(name.slice(last, next))
    last = next
  }
  parts.push(name.slice(last))
  return parts.filter((p, i) => p !== '' || i === 0)
}
