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
  // An inventory names one URI for a name, so a name has one entry here. A bare `Owner.name` is every
  // overload at once and lands on the last the index lists. The nullary overload also has the name it is
  // written with, `Owner.name()`, so a call with no arguments reaches that overload and not another.
  const symbols = new Map<string, { id: string; name: string; kind: 'class' | 'method'; uri: string }>()
  const put = (id: string, name: string, kind: 'class' | 'method', uri: string) => symbols.set(id, { id, name, kind, uri })
  for (const type of types) {
    if (!type.p || !type.l) continue
    const path = `${moduleOf(type)}/${type.p.replace(/\./g, '/')}/${type.u ?? `${type.l}.html`}`
    put(`${type.p}.${type.l}`, type.l, 'class', path)
    put(type.l, type.l, 'class', path)
  }
  const nullary = new Map<string, string>()
  for (const member of members) {
    if (!member.p || !member.c || !member.l) continue
    const bare = member.l.replace(/\(.*$/, '')
    if (!bare || /[^A-Za-z0-9_$]/.test(bare)) continue
    const path = `${moduleOf(member)}/${member.p.replace(/\./g, '/')}/${member.c}.html#${member.u ?? member.l}`
    for (const id of [`${member.c}.${bare}`, `${member.p}.${member.c}.${bare}`]) {
      put(id, bare, 'method', path)
      if (member.l === `${bare}()`) nullary.set(id, path)
    }
  }
  // Only a name whose plain entry is another overload needs its own.
  for (const [id, path] of nullary) if (symbols.get(id)?.uri !== path) put(`${id}()`, symbols.get(id)!.name, 'method', path)
  return [...symbols.values()]
}
