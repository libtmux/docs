import type { DocBlock } from '../model.ts'

/**
 * C# documentation comments, which are XML rather than prose.
 *
 * The spec extractor left the tags in place on the reasoning that `<summary>`
 * and `<param>` are structure a renderer could use — which was right, and then
 * no renderer was written. 2,034 tags reached the page as escaped markup:
 * every .NET description opened with a visible `<summary>` and closed with
 * `</summary> <remarks> <para>`.
 *
 * This is the one language whose compiler already produces a structured doc
 * model, and it was the only one rendering its structure as text.
 *
 * Deliberately not a general XML parser. Doc comments are a small, fixed
 * vocabulary defined by the C# spec, they are not required to be well-formed
 * — an unclosed `<para>` is common and must not lose the rest of the comment
 * — and pulling in a parser to be strict about input that is allowed to be
 * loose would fail on the documents it is meant to read.
 */

/** `<tag ...>inner</tag>`, or `<tag ... />`, for one named tag. */
function sections(xml: string, tag: string): { attrs: string; body: string }[] {
  const out: { attrs: string; body: string }[] = []
  const open = new RegExp(`<${tag}(\\s[^>]*)?\\s*(/?)>`, 'g')
  for (const m of xml.matchAll(open)) {
    const attrs = m[1] ?? ''
    if (m[2] === '/') {
      out.push({ attrs, body: '' })
      continue
    }
    const from = m.index + m[0].length
    const close = xml.indexOf(`</${tag}>`, from)
    // An unclosed tag runs to the next sibling of the same name, or to the
    // end. Dropping it instead would lose the prose it holds.
    const next = xml.slice(from).search(new RegExp(`<${tag}(\\s|>|/)`))
    const end = close === -1 ? (next === -1 ? xml.length : from + next) : close
    out.push({ attrs, body: xml.slice(from, end) })
  }
  return out
}

const attr = (attrs: string, name: string): string | undefined =>
  new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1]

/**
 * Tag soup to prose, keeping the marks a reader sees.
 *
 * `<para>` becomes a blank line because that is what it means; `<see>` and
 * `<c>` are left alone for the inline tokenizer, which resolves them against
 * the symbol table. Everything else is dropped rather than escaped — an
 * unknown tag is markup, and printing it is what this file exists to stop.
 */
function prose(xml: string): string {
  return xml
    .replace(/<para\s*\/?>/g, '\n\n')
    .replace(/<\/para>/g, '')
    .replace(/<list[^>]*>/g, '\n')
    .replace(/<\/list>/g, '\n')
    .replace(/<item>\s*(?:<description>)?/g, '\n- ')
    .replace(/<\/description>\s*<\/item>|<\/item>/g, '')
    .replace(/<(term|description)>|<\/(term|description)>/g, '')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/?(remarks|summary|value|returns|example|inheritdoc)[^>]*>/g, '')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export interface ParsedXmlDoc {
  doc: DocBlock
  params: Map<string, string>
  returnsDoc?: string
  raises: { type: string; doc?: string }[]
}

export function parseXmlDoc(raw: string): ParsedXmlDoc {
  const summary = sections(raw, 'summary')[0]?.body ?? ''
  const remarks = sections(raw, 'remarks')
    .map((s) => prose(s.body))
    .filter(Boolean)
    .join('\n\n')

  const params = new Map<string, string>()
  for (const s of sections(raw, 'param')) {
    const name = attr(s.attrs, 'name')
    const text = prose(s.body)
    if (name && text) params.set(name, text)
  }

  const returnsDoc = prose(sections(raw, 'returns')[0]?.body ?? '') || undefined

  const raises = sections(raw, 'exception')
    .map((s) => ({
      // `cref` carries a one-letter kind prefix — `T:` a type, `M:` a method
      // — which is addressing metadata, not part of the name.
      type: (attr(s.attrs, 'cref') ?? '').replace(/^[A-Z]:/, ''),
      doc: prose(s.body) || undefined,
    }))
    .filter((r) => r.type)

  /**
   * `<example>` holds prose and `<code>` together; the code is the example
   * and the prose introduces it, which is the same shape every other language
   * here produces.
   */
  const examples: { lang: string; code: string; intro?: string }[] = []
  for (const ex of sections(raw, 'example')) {
    const code = sections(ex.body, 'code')
    const intro = prose(ex.body.replace(/<code[\s\S]*?<\/code>/g, '')) || undefined
    for (const c of code) {
      examples.push({
        lang: attr(c.attrs, 'language') ?? 'csharp',
        code: c.body.replace(/^\n+|\s+$/g, ''),
        intro,
      })
    }
  }

  // A comment with no `<summary>` at all is plain prose in a `///`, which the
  // compiler tolerates and people write. Falling back to the whole thing is
  // better than reporting the symbol as undocumented.
  const summaryText = prose(summary) || (raw.includes('<') ? '' : prose(raw))

  return {
    doc: {
      summary: summaryText.replace(/\s+/g, ' ').trim(),
      body: remarks || undefined,
      examples: examples.length ? examples : undefined,
    },
    params,
    returnsDoc,
    raises,
  }
}
