/** A stylesheet's style rules with the `@media` conditions around each, for the tests that read what a rule says. */
export interface Rule { media: string[]; selectors: string[]; declarations: Record<string, string> }

/**
 * The style rules of a stylesheet with the `@media` conditions around each.
 * Comments go first; quotes and parentheses keep a `;` or `{` inside a string or `url()` out of the split.
 */
export function parseRules(source: string): Rule[] {
  const rules: Rule[] = []
  const stack: { prelude: string; declarations: Record<string, string> }[] = [{ prelude: '', declarations: {} }]
  let buffer = ''
  let quote = ''
  let parens = 0
  const declare = () => {
    const at = buffer.indexOf(':')
    if (at > 0 && stack.length > 1) stack.at(-1)!.declarations[buffer.slice(0, at).trim()] = buffer.slice(at + 1).trim()
    buffer = ''
  }
  for (const char of source.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (quote) { if (char === quote) quote = ''; buffer += char; continue }
    if (char === '"' || char === "'") { quote = char; buffer += char; continue }
    if (char === '(') parens++
    if (char === ')') parens--
    if (char === '{' && parens === 0) { stack.push({ prelude: buffer.trim(), declarations: {} }); buffer = '' }
    else if (char === '}' && parens === 0) {
      declare()
      const done = stack.pop()!
      if (Object.keys(done.declarations).length > 0) {
        const selectors: string[] = []
        let depth = 0
        let start = 0
        for (let i = 0; i < done.prelude.length; i++) {
          const c = done.prelude[i]
          if (c === '(' || c === '[') depth++
          if (c === ')' || c === ']') depth--
          if (c === ',' && depth === 0) { selectors.push(done.prelude.slice(start, i).trim()); start = i + 1 }
        }
        selectors.push(done.prelude.slice(start).trim())
        rules.push({
          media: stack.map((frame) => frame.prelude).filter((prelude) => prelude.startsWith('@media'))
            .map((prelude) => prelude.slice('@media'.length).replace(/\s+/g, ' ').trim()),
          selectors, declarations: done.declarations,
        })
      }
    } else if (char === ';' && parens === 0) declare()
    else buffer += char
  }
  return rules
}
