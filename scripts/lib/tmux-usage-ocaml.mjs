import { basename, dirname } from 'node:path'

/** Resolve public .mli values through the implementation's module aliases and includes. */
export function bindOcamlDefinitions({ symbols, functions, modules, sources }) {
  const files = [...sources.keys()]
  const moduleName = (file) => basename(file, '.ml').replace(/^./, (letter) => letter.toUpperCase())
  const external = (name, from) => {
    const matches = files.filter((file) => moduleName(file) === name)
    return matches.find((file) => dirname(file) === dirname(from)) ?? (matches.length === 1 ? matches[0] : undefined)
  }
  const resolve = (file, path, name, seen = new Set()) => {
    const key = `${file}:${path}:${name}`
    if (seen.has(key)) return []
    const visited = new Set([...seen, key])
    const own = functions.filter((fn) => fn.file === file && fn.modulePath === path && fn.name === name)
    if (own.length) return own
    const aliases = modules.filter((module) => module.file === file && module.path === path && module.target && !module.open)
    for (const alias of aliases) {
      const parts = alias.target.split('.')
      const targetFile = external(parts[0], file)
      if (targetFile) {
        const found = resolve(targetFile, parts.slice(1).join('.'), name, visited)
        if (found.length) return found
      }
    }
    const segments = path.split('.').filter(Boolean)
    for (let count = segments.length - 1; count >= 0; count--) {
      const prefix = segments.slice(0, count).join('.')
      const next = segments.slice(0, count + 1).join('.')
      const aliases = modules.filter((module) => module.file === file && module.path === next && module.target && !module.include && !module.open)
      for (const alias of aliases) {
        const parts = alias.target.split('.')
        const targetFile = external(parts[0], file)
        if (!targetFile) continue
        const found = resolve(targetFile, [...parts.slice(1), ...segments.slice(count + 1)].join('.'), name, visited)
        if (found.length) return found
      }
      // An included module contributes the values and nested modules of its scope.
      for (const include of modules.filter((module) => module.file === file && module.path === prefix && module.include)) {
        const parts = include.target.split('.')
        const targetFile = external(parts[0], file)
        if (!targetFile) continue
        const found = resolve(targetFile, [...parts.slice(1), ...segments.slice(count)].join('.'), name, visited)
        if (found.length) return found
      }
    }
    return []
  }
  for (const symbol of symbols) {
    const file = symbol.file.replace(/\.mli$/, '.ml')
    const parts = (symbol.qualified ?? symbol.id).split('.')
    symbol.implementations = resolve(file, parts.slice(1, -1).join('.'), symbol.name).filter((fn) => !fn.enclosing && !fn.moduleArgument)
  }
  for (const caller of functions) {
    caller.moduleCalls = new Map()
    for (const call of caller.callList ?? []) {
      const parts = call.path?.split('.') ?? []
      const name = parts.pop()
      if (!name) continue
      let found
      if (parts.length) {
        found = resolve(caller.file, parts.join('.'), name)
        if (!found.length) {
          const targetFile = external(parts[0], caller.file)
          if (targetFile) found = resolve(targetFile, parts.slice(1).join('.'), name)
        }
      } else {
        found = resolve(caller.file, caller.modulePath, name)
        if (!found.length) for (const opened of modules.filter((module) => module.file === caller.file && module.open && (!module.path || caller.modulePath.startsWith(module.path)))) {
          const parts = opened.target.split('.')
          const targetFile = external(parts[0], caller.file)
          if (targetFile) found.push(...resolve(targetFile, parts.slice(1).join('.'), name))
        }
      }
      call.targets = new Set(found.filter((fn) => !fn.enclosing || (fn.file === caller.file && fn.enclosing.start <= call.line && call.line <= fn.enclosing.end))
        .map((fn) => `${fn.file}:${fn.start}:${fn.name}`))
      caller.moduleCalls.set(name, new Set([...(caller.moduleCalls.get(name) ?? []), ...call.targets]))
    }
  }
}
