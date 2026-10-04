import HOME_EXAMPLES from '../data/home-examples.json'

/** Complete homepage programs and their selectable detail levels. */
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
  variants: Record<Exclude<HomeView, 'full'>, string>
  automaticCleanup?: string
}

export const HOME_VIEWS = ['concise', 'errors', 'cleanup', 'full'] as const
export type HomeView = typeof HOME_VIEWS[number]

/** Each view is a complete program, including its imports and initialization. */
export function homeProgram(example: HomeExample, view: HomeView): string {
  const program = example.files.find((file) => file.name === example.program)
  if (!program) throw new Error(`Missing homepage program ${example.program}`)
  return view === 'full' ? program.code : example.variants[view]
}

export function homeCodeColumns(code: string): number {
  return Math.max(...code.split('\n').map((line) => Array.from(line).reduce(
    (column, char) => column + (char === '\t' ? 8 - column % 8 : 1), 0,
  )))
}

export const QUICKSTARTS: Partial<Record<string, Quickstart>> = Object.fromEntries(
  Object.entries(HOME_EXAMPLES).map(([port, complete]) => [port, {
    lang: complete.lang,
    code: homeProgram(complete, 'concise').replace(/\n$/, ''),
    source: `Verified against ${complete.sourceRepository} at ${complete.sourceRevision.slice(0, 12)}.`,
    complete,
  }]),
)
