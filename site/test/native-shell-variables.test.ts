import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * scripts/inject-shell.mjs fails a native build when a rule scoped to html[data-native-shell] reads a variable that no
 * stylesheet declares. The --native-* variables belong to native-sphinx.css, including the ones a script writes at
 * runtime, so each needs a declaration here; the port builds are the first place the check runs on real pages.
 */
const source = readFileSync(new URL('../src/styles/native-sphinx.css', import.meta.url), 'utf8')

/** --native-* variables read in html[data-native-shell] rules and not declared anywhere in the sheet. */
function undeclared(css: string) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = [...stripped.matchAll(/[^{}]*html\[data-native-shell\][^{}]*\{([^{}]*)\}/g)].map((match) => match[1]).join('\n')
  const read = new Set([...rules.matchAll(/var\((--native-[a-z0-9-]+)/gi)].map((match) => match[1]))
  return [...read].filter((name) => !stripped.includes(`${name}:`))
}

describe('native shell variables', () => {
  it('declares every --native-* variable its rules read', () => {
    expect(undeclared(source)).toEqual([])
  })

  it('reports a runtime variable without a declaration, so the check above can fail', () => {
    const missing = source.replace(/^\s*--native-class-row-height:[^;]*;\n/m, '')
    expect(missing).not.toBe(source)
    expect(undeclared(missing)).toEqual(['--native-class-row-height'])
  })
})
