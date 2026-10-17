interface JavadocPackage {
  l: string
  m?: string
}

interface JavadocType {
  l: string
  p?: string
  m?: string
  u?: string
}

interface JavadocMember extends JavadocType {
  c?: string
}

/** Convert Javadoc search indexes without guessing a package's module. */
export function javadocSymbols(
  packages: JavadocPackage[],
  types: JavadocType[],
  members: JavadocMember[],
) {
  const owners = new Map<string, Set<string>>()
  for (const pkg of packages) {
    if (!pkg.m) continue
    const modules = owners.get(pkg.l) ?? new Set<string>()
    modules.add(pkg.m)
    owners.set(pkg.l, modules)
  }
  const moduleOf = (entry: JavadocType) => {
    const modules = owners.get(entry.p!)
    if (entry.m && modules?.has(entry.m)) return entry.m
    if (!entry.m && modules?.size === 1) return [...modules][0]
    throw new Error(`Javadoc package ${entry.p}: ${entry.m ? `unknown module ${entry.m}` : 'missing or ambiguous module'}`)
  }
  const symbols: { id: string; name: string; kind: 'class' | 'method'; uri: string }[] = []
  for (const type of types) {
    if (!type.p || !type.l) continue
    const path = `${moduleOf(type)}/${type.p.replace(/\./g, '/')}/${type.u ?? `${type.l}.html`}`
    symbols.push({ id: `${type.p}.${type.l}`, name: type.l, kind: 'class', uri: path })
    symbols.push({ id: type.l, name: type.l, kind: 'class', uri: path })
  }
  for (const member of members) {
    if (!member.p || !member.c || !member.l) continue
    const bare = member.l.replace(/\(.*$/, '')
    if (!bare || /[^A-Za-z0-9_$]/.test(bare)) continue
    const path = `${moduleOf(member)}/${member.p.replace(/\./g, '/')}/${member.c}.html#${member.u ?? member.l}`
    symbols.push({ id: `${member.c}.${bare}`, name: bare, kind: 'method', uri: path })
    symbols.push({ id: `${member.p}.${member.c}.${bare}`, name: bare, kind: 'method', uri: path })
  }
  return symbols
}
