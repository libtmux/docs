/**
 * Text no documentation page links, whatever it resembles.
 *
 * - A variable the reader owns (`$SocketPath`, `$control`): it names no page, and linking every `$name` to
 *   the topic on variables said nothing about it.
 * - Text a program prints (`[object Object]`): it is a string, not a type that mentions `Object`.
 *
 * One predicate, read by every path that links a name (the type tokenizer `linkType`, which `linkLiteral`,
 * `docSpans` and the Markdown export all call, and the prose linker `decideMention`), so none of them can
 * link what another leaves plain.
 */
export function neverLinks(text: string): string | undefined {
  const t = text.trim()
  if (/^\$[A-Za-z_]/.test(t)) return 'a variable'
  if (/^\[object [A-Za-z]+\]$/.test(t)) return 'text a program prints'
  return undefined
}
