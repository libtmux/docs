/**
 * What a documentation address says about the symbol it documents.
 *
 * A host that gives every symbol its own address spells the symbol's package,
 * type and member in it: `std/io/struct.Error.html`, `pkg.go.dev/errors#Join`,
 * `system.threading.timer`, `Optional.html#of(T)`, `str.join` in a CPython
 * fragment. Reading that path is exact where searching the page for a word is
 * not, because the page for `ArrayList` says `List` in a heading, a CPython
 * entry names the types its neighbours take, and `sort!` contains `sort`.
 *
 * `addressOf` returns the path outermost first, ending in the member the
 * fragment names. A link is right when the name that led to it, written in
 * full, is the end of that path. A host whose fragments are headings, or whose
 * address says nothing of a symbol, has no address here and is read from the
 * page.
 */

/** Where a URL asks to land, split into the page and the fragment. */
export function splitUrl(url) {
  const hash = url.indexOf('#')
  return hash < 0 ? { page: url, fragment: '' } : { page: url.slice(0, hash), fragment: url.slice(hash + 1) }
}

const decode = (text) => { try { return decodeURIComponent(text) } catch { return text } }

/** A CPython, Documenter or pkg.go.dev fragment that is a dotted name: `str.join`, `Base.sort!`, `Time.Add`. */
const DOTTED = /^[A-Za-z_@][\w!?@$]*(?:\.[A-Za-z_@][\w!?@$]*)*$/

const RUST_ITEM = /^(?:struct|enum|trait|fn|macro|type|constant|primitive|union|attr|derive|keyword|static)\.(.+)$/
const RUST_MEMBER = /^(?:method|tymethod|variant|structfield|associatedtype|associatedconstant|constant|static)\.(.+)$/

const dotted = (text) => text.split('.').filter(Boolean)

/**
 * @typedef {object} Address
 * @property {string[]} path The packages, type and member the address spells, outermost first.
 * @property {boolean} exact Whether segments compare as written; otherwise by their letters and digits, ignoring case.
 * @property {'none' | 'member' | 'heading'} fragment `member` when the fragment names an entry and is the path's last segment.
 * @property {string} [arity] The operand count an entry's fragment carries, as ExDoc writes `map/2`.
 * @property {string} [type] The type or module the page is for, when the address names one.
 */

/** @returns {Address | undefined} */
export function addressOf(url) {
  const { page, fragment: rawFragment } = splitUrl(url)
  let u
  try { u = new URL(page) } catch { return undefined }
  const fragment = decode(rawFragment)
  const dirs = decode(u.pathname).split('/').filter(Boolean)
  const file = dirs.pop() ?? ''
  const stem = file.replace(/\.html?$/i, '')
  const host = u.hostname
  const none = fragment ? 'heading' : 'none'

  if (host === 'doc.rust-lang.org' || host === 'docs.rs') {
    const item = RUST_ITEM.exec(stem)
    const type = item ? item[1] : stem === 'index' || !file ? undefined : stem
    const path = [...dirs, ...(type ? [type] : [])]
    const member = RUST_MEMBER.exec(fragment)
    if (fragment && !member) return { path, exact: true, fragment: 'heading', type }
    return { path: member ? [...path, member[1]] : path, exact: true, fragment: member ? 'member' : 'none', type }
  }

  if (host === 'pkg.go.dev') {
    const path = [...dirs, file].filter(Boolean).map((segment) => segment.replace(/@.*$/, ''))
    if (!fragment) return { path, exact: true, fragment: 'none' }
    return DOTTED.test(fragment) ? { path: [...path, ...dotted(fragment)], exact: true, fragment: 'member' } : { path, exact: true, fragment: 'heading' }
  }

  if (host === 'docs.python.org') {
    if (fragment) {
      const module = /^module-(.+)$/.exec(fragment)
      if (module && DOTTED.test(module[1])) return { path: dotted(module[1]), exact: true, fragment: 'member' }
      return DOTTED.test(fragment) ? { path: dotted(fragment), exact: true, fragment: 'member' } : { path: dotted(stem), exact: true, fragment: 'heading' }
    }
    return { path: dotted(stem), exact: true, fragment: 'none' }
  }

  if (host === 'docs.julialang.org') {
    if (!fragment) return { path: dotted(stem), exact: true, fragment: 'none' }
    // Documenter appends a method's signature to its anchor: `Core.String-Tuple{AbstractString}`.
    const entry = fragment.replace(/-(?:Tuple|Union|Type|Vararg)\b.*$/, '')
    return DOTTED.test(entry) ? { path: dotted(entry), exact: true, fragment: 'member' } : { path: dotted(stem), exact: true, fragment: 'heading' }
  }

  if (host.endsWith('hexdocs.pm')) {
    const type = stem
    if (!file) return undefined
    const path = dotted(type)
    if (!fragment) return { path, exact: true, fragment: 'none', type }
    const entry = /^(?:[tc]:)?([^/\s]+?)(?:\/(\d+))?$/.exec(fragment)
    // ExDoc's own sections are kebab-case words; an entry is a function or type name.
    return entry && !/-/.test(entry[1]) ? { path: [...path, entry[1]], exact: true, fragment: 'member', arity: entry[2], type } : { path, exact: true, fragment: 'heading', type }
  }

  if (host === 'docs.oracle.com' || host === 'docs.junit.org' || host === 'javadoc.io' || host === 'www.scala-lang.org' || host === 'typelevel.org') {
    // Javadoc and Scaladoc: directories are the module and package, the file is the type (`Flow.Publisher`).
    if (host === 'docs.oracle.com' && !u.pathname.includes('/api/')) return undefined
    if (host === 'www.scala-lang.org' && !u.pathname.includes('/api/')) return undefined
    if (!file || stem === 'index') return undefined
    const type = stem.replace(/\$$/, '')
    const path = [...dirs.flatMap((dir) => dotted(dir)), ...dotted(type)]
    if (!fragment) return { path, exact: true, fragment: 'none', type }
    // `of(T)` in javadoc, `resource-fffffb81` in scaladoc, `MAX_VALUE` for a field.
    const member = /^([A-Za-z_$][\w$]*)(?:\(.*\)|-[0-9a-f]{8})?$/.exec(fragment)
    return member ? { path: [...path, member[1]], exact: true, fragment: 'member', type } : { path, exact: true, fragment: 'heading', type }
  }

  if (host === 'learn.microsoft.com') {
    const lower = u.pathname.toLowerCase()
    if (lower.includes('/dotnet/api/')) {
      const path = dotted(stem || file).map((segment, index, all) => (index === all.length - 1 ? segment.replace(/-\d+$/, '') : segment))
      return { path, exact: false, fragment: none, type: path.at(-1) }
    }
    if (lower.includes('/powershell/module/')) {
      const cmdlet = stem.replace(/^about_/i, '')
      return { path: [...dirs.slice(dirs.findIndex((dir) => dir.toLowerCase() === 'module') + 1).flatMap((dir) => dotted(dir)), cmdlet], exact: false, fragment: none, type: cmdlet }
    }
    return undefined
  }

  if (host === 'kotlinlang.org' && u.pathname.includes('/api/')) {
    // Dokka: a directory per package, a `-type` directory per type, a file per member.
    const parts = [...dirs.slice(dirs.indexOf('api') + 1), ...(stem && stem !== 'index' ? [stem] : [])]
    const path = parts.flatMap((part) => (part.startsWith('-') || part.includes('-') ? [part] : dotted(part)))
    return { path, exact: false, fragment: none }
  }

  if (host === 'developer.apple.com' && dirs[0] === 'documentation') {
    const path = [...dirs.slice(1), ...(file ? [file] : [])]
    return { path, exact: false, fragment: none, type: path.at(-1) }
  }

  if (host === 'fsharp.github.io' && u.pathname.includes('/reference/')) {
    // fsdocs names a page for its namespace and type: `fsharp-collections-seqmodule`, `fsharp-core-fsharpresult-2`.
    const words = stem.split('-').filter((word) => !/^\d+$/.test(word))
    const last = (words.pop() ?? '').replace(/^fsharp(?=\w)/, '').replace(/module$/, '')
    const namespace = words
    const member = fragment && /^[A-Za-z_]\w*$/.test(fragment) ? [fragment] : []
    return { path: [...namespace, last, ...member], exact: false, fragment: fragment ? (member.length ? 'member' : 'heading') : 'none', type: last }
  }

  if (host === 'gofastmcp.com' && dirs[0] === 'python-sdk') {
    // One page per module, named by its dotted path with hyphens; its anchors are the module's names.
    const module = stem.split('-')
    const member = fragment && /^[A-Za-z_]\w*$/.test(fragment) ? [fragment] : []
    return { path: [...module, ...member], exact: false, fragment: fragment ? (member.length ? 'member' : 'heading') : 'none' }
  }

  if (host === 'csharp.sdk.modelcontextprotocol.io' && u.pathname.includes('/api/')) {
    // DocFX: a page per type, named by its full dotted name; a member's anchor is its full name with underscores.
    const path = dotted(stem)
    if (!fragment) return { path, exact: false, fragment: 'none', type: path.at(-1) }
    return fragment.includes('_') ? { path: fragment.split('_'), exact: false, fragment: 'member', type: path.at(-1) } : { path, exact: false, fragment: 'heading', type: path.at(-1) }
  }

  if (host === 'developer.mozilla.org' && u.pathname.includes('/docs/')) {
    return { path: [...dirs.slice(dirs.indexOf('docs') + 1), ...(file ? [file] : [])], exact: false, fragment: none }
  }

  return undefined
}

// `!` and `?` end names (`sort!`, `empty?`), so they are part of what is compared.
const normal = (segment, exact) => (exact ? segment : segment.toLowerCase().replace(/[^a-z0-9!?]/g, ''))

/**
 * Whether the name that led to an address, written in full, ends the address's
 * path. Returns `undefined` when it does, else which part differs: `symbol`
 * when the last segment does, `owner` when a package, module or type before it
 * does.
 *
 * @param {string[]} name
 * @param {Address} address
 */
export function mismatch(name, address) {
  const path = address.path
  const exact = address.exact
  if (name.length === 0) return 'symbol'
  const last = name.length - 1
  if (path.length === 0 || normal(name[last], exact) !== normal(path.at(-1), exact)) return 'symbol'
  for (let offset = 1; offset < name.length; offset += 1) {
    const wanted = path.at(-1 - offset)
    if (wanted === undefined || normal(name[last - offset], exact) !== normal(wanted, exact)) return 'owner'
  }
  return undefined
}

/**
 * cppreference spells no namespace in an address (`cpp/chrono/time_point/max`),
 * but its titles spell the name (`std::chrono::time_point<...>::max`). A name
 * written with namespaces is `std` and then each one the address or the title
 * names, so `Keyword::ptrdiff_t` and `std::chrono::sync::time_point::max` are not
 * the pages they point at. Returns `undefined` when the namespaces fit, else
 * `owner`.
 */
export function namespaceMismatch(url, segments, title) {
  if (segments.length < 2) return undefined
  const { pathname } = new URL(splitUrl(url).page)
  const words = (text) => text.split(/[^A-Za-z0-9_]+/).filter(Boolean).map((word) => word.toLowerCase())
  const known = new Set([...words(pathname.replace(/^\/cpp\//, '')), ...words(title)])
  const [head, ...scope] = segments.slice(0, -1)
  if (head !== 'std') return 'owner'
  return scope.every((namespace) => known.has(namespace.toLowerCase())) ? undefined : 'owner'
}
