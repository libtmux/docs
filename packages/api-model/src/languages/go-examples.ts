import { basename, dirname } from 'node:path'
import type { ApiSymbol, DocBlock } from '../model.ts'
import { parserFor } from '../parser.ts'

export interface CompleteGoExample {
  symbol: string
  file: string
  code: string
  intro: string
  output: string
}

/** Read opt-in native examples without turning ordinary test helpers into API pages. */
export async function readCompleteGoExamples(files: { file: string; code: string }[]): Promise<CompleteGoExample[]> {
  const parser = await parserFor('go')
  const examples: CompleteGoExample[] = []
  const seen = new Set<string>()
  try {
    for (const { file, code } of files) {
      if (!file.endsWith('_test.go') || !/\bfunc Example\w+_complete\(/.test(code)) continue
      const tree = parser.parse(code)
      if (!tree) throw new Error(`Cannot parse complete Go example: ${file}`)
      try {
        const root = tree.rootNode
        const fail = (reason: string): never => {
          throw new Error(`Invalid complete Go example ${file}: ${reason}`)
        }
        if (root.hasError) fail('invalid Go syntax')
        const declarations = root.namedChildren.filter((node) => node?.type === 'function_declaration')
        if (declarations.length !== 1) fail('one complete Example function per file is required')
        const declaration = declarations[0]!
        const name = declaration.childForFieldName('name')?.text ?? ''
        const match = /^Example([A-Z][A-Za-z0-9]*)(?:_([A-Z][A-Za-z0-9]*))?_complete$/.exec(name)
        if (!match) fail('expected ExampleName_complete or ExampleType_Method_complete')
        if (
          declaration.childForFieldName('parameters')?.namedChildCount ||
          declaration.childForFieldName('result') ||
          declaration.childForFieldName('type_parameters')
        ) {
          fail('Example functions cannot have parameters, results, or type parameters')
        }
        const scope = basename(dirname(file))
        const packageName = root.namedChildren.find((node) => node?.type === 'package_clause')?.namedChildren[0]?.text
        if (packageName !== `${scope}_test`) fail('use an external test package beside its API')
        const symbol = `${scope}.${match![1]}${match![2] ? `.${match![2]}` : ''}`
        if (seen.has(symbol)) fail(`duplicate example for ${symbol}`)

        const lines: string[] = []
        let comment = declaration.previousNamedSibling
        let row = declaration.startPosition.row
        while (comment?.type === 'comment' && comment.endPosition.row === row - 1) {
          if (!comment.text.startsWith('//')) fail('describe the example with Go line comments')
          lines.unshift(comment.text.replace(/^\/\/ ?/, ''))
          row = comment.startPosition.row
          comment = comment.previousNamedSibling
        }
        const intro = lines.join('\n').trim()
        if (!intro) fail('a task description is required')
        const output = /\/\/ Output:([^\n]*)\n((?:[\t ]*\/\/[^\n]*\n)*)[\t ]*\}$/.exec(declaration.text)
        if (!output) fail('a final Output assertion is required')
        const expected = [
          output![1].trim(),
          ...output![2]
            .trimEnd()
            .split('\n')
            .map((line) => line.replace(/^[\t ]*\/\/ ?/, '')),
        ]
          .join('\n')
          .trim()
        if (!expected) fail('the Output assertion must describe an observable result')
        seen.add(symbol)
        examples.push({ symbol, file, code, intro, output: expected })
      } finally {
        tree.delete()
      }
    }
  } finally {
    parser.delete()
  }
  return examples
}

/** Attach whole native test files and all setup needed to run them independently. */
export function attachCompleteGoExamples(
  symbols: ApiSymbol[],
  examples: CompleteGoExample[],
  source: { repo: string; revision: string; goVersion: string },
): void {
  if (!/^[0-9a-f]{40}$/.test(source.revision)) throw new Error('Go examples require a full source revision')
  if (!/^\d+\.\d+\.\d+$/.test(source.goVersion)) throw new Error('Go examples require the module Go version')
  for (const example of examples) {
    const matches = symbols.filter((symbol) => symbol.id === example.symbol)
    if (matches.length !== 1) throw new Error(`Go example target must resolve once: ${example.symbol}`)
    const symbol = matches[0]
    const blocks: NonNullable<DocBlock['examples']> = [
      {
        lang: 'console',
        intro: `${example.intro.replace(/\n/g, ' ')} Use Go ${source.goVersion} or newer and tmux 3.2a or newer on a Unix system, with tmux and cat on PATH. In a new directory, fetch the documented library revision:`,
        code: `$ git clone https://github.com/${source.repo}.git libtmux-source && \\\n  git -C libtmux-source checkout ${source.revision}\n`,
      },
      {
        lang: 'go',
        intro: 'Save this dependency file as go.mod:',
        code: `module example.com/libtmux-api\n\ngo ${source.goVersion}\n\nrequire github.com/libtmux/libtmux-go v0.0.0\n\nreplace github.com/libtmux/libtmux-go => ./libtmux-source\n`,
      },
      {
        lang: 'go',
        intro:
          'Save this complete example as example_test.go. It creates a private temporary socket and stops its server before removing the directory. Cleanup failure fails the example and retains the socket directory.',
        sourceUrl: `https://github.com/${source.repo}/blob/${source.revision}/${example.file}`,
        code: example.code,
      },
      {
        lang: 'console',
        intro:
          'Run the saved file. Go checks the Output comment and fails on different output or an operation or cleanup error:',
        code: '$ GOWORK=off go test -count=1 -v example_test.go\n',
      },
    ]
    symbol.doc = { summary: '', ...symbol.doc, examples: [...(symbol.doc?.examples ?? []), ...blocks] }
  }
}
