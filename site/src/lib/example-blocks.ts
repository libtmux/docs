/**
 * Which code blocks of an example page are backed by a tested source.
 *
 * An example page may show a block only if the build can tie it to code that
 * runs: an excerpt of a tested file, a titled file whose bytes a recorded
 * native run hashed, the recorded run command, or the recorded output. Any
 * other block is hand-typed text that can drift from what the page claims.
 */
import { createHash } from 'node:crypto'
import { ExcerptError, excerptRequest, pageSource, parseFenceAttributes, sliceExcerpt } from './example-excerpt.ts'

/** What a recorded native run of a page covers. */
export interface RunRecord {
  /** Displayed files by name, each with the hashes a run accepted. */
  files: ReadonlyMap<string, ReadonlySet<string>>
  /** Commands of the recorded run, as the console blocks spell them. */
  commands: ReadonlySet<string>
  /** Lines the recorded run must print. */
  outputs: ReadonlySet<string>
}

export interface Fence {
  /** One-based line of the opening fence. */
  line: number
  language: string
  meta: string
  /** The text between the fences, every line ending in a newline. */
  body: string
}

/** Every fenced block of a Markdown page, in order. */
export function fencesOf(markdown: string): Fence[] {
  const found: Fence[] = []
  let open: (Fence & { marker: string; length: number; lines: string[] }) | undefined
  markdown.split('\n').forEach((text, index) => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text)
    if (!open && marker && !(marker[1]![0] === '`' && marker[2]!.includes('`'))) {
      const [, language = '', meta = ''] = /^(\S*)(.*)$/.exec(marker[2]!.trimStart())!
      open = { line: index + 1, language: language.toLowerCase(), meta: meta.trim(), body: '', marker: marker[1]![0]!, length: marker[1]!.length, lines: [] }
    } else if (open && marker && marker[1]![0] === open.marker && marker[1]!.length >= open.length && !marker[2]!.trim()) {
      found.push({ line: open.line, language: open.language, meta: open.meta, body: open.lines.map((line) => `${line}\n`).join('') })
      open = undefined
    } else if (open) open.lines.push(text)
  })
  return found
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const SHELL = new Set(['sh', 'bash', 'shell'])

/** Source text with quoted strings and comments removed, so delimiters can be counted. */
function skeleton(text: string, language: string): string {
  const shell = SHELL.has(language)
  let out = ''
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (char === '"' || char === "'" || (!shell && char === '`')) {
      for (index++; index < text.length && text[index] !== char; index++) {
        if (text[index] === '\\' && char !== "'") index++
      }
      out += '""'
    } else if ((shell && char === '#' && (index === 0 || /\s/.test(text[index - 1]!))) || (!shell && char === '/' && text[index + 1] === '/')) {
      while (index < text.length && text[index] !== '\n') index++
      out += '\n'
    } else out += char
  }
  return out
}

/**
 * Why an excerpt is not a whole unit of code, or undefined when it is. The
 * end anchor of a range names the first matching line, so a closing line the
 * file repeats can end a range early; unbalanced delimiters show it.
 */
export function unbalanced(text: string, language: string): string | undefined {
  const code = skeleton(text, language)
  const pairs: [string, string][] = [['{', '}'], ['(', ')'], ['[', ']']]
  for (const [open, close] of pairs) {
    let depth = 0
    for (const char of code) {
      if (char === open) depth++
      if (char === close && --depth < 0) return `closes ${close} it never opened`
    }
    if (depth) return `opens ${open} it never closes`
  }
  if (SHELL.has(language)) {
    const words: [string, string][] = [['if', 'fi'], ['do', 'done']]
    for (const [open, close] of words) {
      let depth = 0
      for (const word of code.match(/\b[a-z]+\b/g) ?? []) {
        if (word === open) depth++
        if (word === close && --depth < 0) return `closes ${close} it never opened`
      }
      if (depth) return `opens ${open} it never closes`
    }
  }
  return undefined
}

export interface PageCheck {
  markdown: string
  /** The recorded native run of this page, if it has one. */
  record?: RunRecord
  /** The port that owns a fence language, such as `go` for `go`. */
  ownerOf: (language: string) => string | undefined
  /** A file from a port's revision-bound example cache. */
  readCached: (owner: string, file: string) => string | undefined
}

/**
 * Every code block of the page that no tested source backs, one message each.
 * An empty list means each block is an excerpt that resolves to whole code,
 * a cached whole file, a recorded file, command or output.
 */
export function checkExampleBlocks({ markdown, record, ownerOf, readCached }: PageCheck): string[] {
  const blocks = fencesOf(markdown)
  const problems: string[] = []
  const report = (fence: Fence, message: string) => problems.push(`line ${fence.line}: \`\`\`${fence.language}${fence.meta ? ` ${fence.meta}` : ''}: ${message}`)
  const pageBlocks = blocks.map((fence) => ({ meta: fence.meta, value: fence.body.replace(/\n$/, '') }))

  for (const fence of blocks) {
    const attributes = parseFenceAttributes(fence.meta)
    let request
    try {
      request = excerptRequest(attributes)
    } catch (error) {
      if (!(error instanceof ExcerptError)) throw error
      report(fence, error.message)
      continue
    }

    if (request) {
      if (fence.body.trim()) {
        report(fence, 'an excerpt carries no text of its own; remove the body so the build can fill it')
        continue
      }
      try {
        const owner = ownerOf(fence.language)
        let source: string
        if (request.source.kind === 'page') source = pageSource(pageBlocks, request.source.name, 'the page')
        else {
          const cached = owner ? readCached(owner, request.source.name) : undefined
          if (cached === undefined) throw new ExcerptError(`${request.source.name} is not in the ${owner ?? fence.language} example cache`)
          source = cached
        }
        const excerpt = sliceExcerpt(source, request, request.source.name)
        const why = unbalanced(excerpt, fence.language)
        if (why) report(fence, `the excerpt of ${request.source.name} ${why}; move the end anchor`)
      } catch (error) {
        if (!(error instanceof ExcerptError)) throw error
        report(fence, error.message)
      }
      continue
    }

    if (attributes.file !== undefined) {
      const owner = ownerOf(fence.language)
      if (!owner || readCached(owner, attributes.file) === undefined) report(fence, `${attributes.file} is not in the example cache`)
      else if (fence.body.trim()) report(fence, 'a file inclusion carries no text of its own')
      continue
    }

    if (attributes.title !== undefined) {
      const accepted = record?.files.get(attributes.title)
      if (!accepted) report(fence, `no recorded run displays a file named ${attributes.title}`)
      else if (!accepted.has(sha256(fence.body))) report(fence, `its bytes differ from the recorded run of ${attributes.title}`)
      continue
    }

    if (fence.language === 'console') {
      const command = fence.body.replace(/^\$ /gm, '').trim()
      if (!record?.commands.has(command)) report(fence, 'this command is not a recorded run command')
      continue
    }

    const lines = fence.body.split('\n').map((line) => line.trim()).filter(Boolean)
    if (fence.language === 'text' && lines.length && lines.every((line) => record?.outputs.has(line))) continue
    report(fence, 'hand-typed block: quote a tested file with an excerpt, or record the run that prints it')
  }
  return problems
}
