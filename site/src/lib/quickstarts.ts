import HOME_EXAMPLES from '../data/home-examples.json'

/** Homepage excerpts and their complete, native-verified programs. */
export interface Quickstart {
  /** Shiki language id for the block. */
  lang: string
  code: string
  /** Where the snippet was taken from, so a reader can check it. */
  source: string
  note?: string
  complete?: HomeExample
}

export interface HomeExample {
  lang: string
  sourceRepository: string
  sourceRevision: string
  sourceTree: string
  program: string
  excerpt: { startLine: number; endLine: number; dedent: number; importsEndLine: number }
  files: { name: string; lang: string; code: string }[]
  prerequisites: string
  commands: string[]
  expectedOutput: string
}

/** Select only complete source lines; the full executable files stay available. */
export function homeExcerpt(example: HomeExample): string {
  const program = example.files.find((file) => file.name === example.program)
  if (!program) throw new Error(`Missing homepage program ${example.program}`)
  const { startLine, endLine, dedent, importsEndLine } = example.excerpt
  const lines = program.code.split('\n')
  const imports = lines.slice(0, importsEndLine).join('\n')
  const task = lines.slice(startLine - 1, endLine)
    .map((line) => line.trim() ? line.slice(dedent) : '').join('\n')
  return imports ? `${imports}\n\n${task}` : task
}

export const QUICKSTARTS: Partial<Record<string, Quickstart>> = Object.fromEntries(
  Object.entries(HOME_EXAMPLES).map(([port, complete]) => [port, {
    lang: complete.lang,
    code: homeExcerpt(complete),
    source: `Verified against ${complete.sourceRepository} at ${complete.sourceRevision.slice(0, 12)}.`,
    complete,
  }]),
)
