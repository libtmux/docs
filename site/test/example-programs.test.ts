import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import { fromHtml } from 'hast-util-from-html'
import { visit } from 'unist-util-visit'
import { ExamplePrograms, SourceBinding, verifyExamplePrograms } from '../src/lib/example-programs.mjs'
import { remarkPortCode } from '../src/plugins/remark-port-code.mjs'

type Root = ReturnType<typeof fromHtml>
type Element = Extract<Root['children'][number], { type: 'element' }>

const scratch = mkdtempSync(join(tmpdir(), 'libtmux-markdown-binding-'))
const cli = fileURLToPath(new URL('../scripts/markdown-examples.mjs', import.meta.url))
const cache = fileURLToPath(new URL('../src/data/example-sources.json', import.meta.url))
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
let serial = 0
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

function fixture(source: string, program: Record<string, unknown> = {}, includeCache = false) {
  const prefix = join(scratch, String(serial++))
  const page = prefix + '.md'
  const recipe = prefix + '.recipe.json'
  const binding = prefix + '.binding.json'
  const receipt = prefix + '.render.json'
  const output = prefix + '.html'
  writeFileSync(page, source)
  writeFileSync(recipe, JSON.stringify({ schema: 1, programs: [{ id: 'copied', document: page,
    rendered: 'index.html', files: [{ path: 'copied.mjs', language: 'javascript', block: 0 }],
    commands: [[process.execPath, 'copied.mjs']], stdout: 'copied.js\n', ...program }] }))
  const inputs = [page, recipe, ...(includeCache ? [cache] : [])]
  writeFileSync(binding, JSON.stringify({ schema: 1, runId: prefix,
    inputs: Object.fromEntries(inputs.map((path) => [path, sha256(readFileSync(path))])) }))
  const command = (args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 5000 })
  const render = () => command(['render', '--binding', binding, '--recipe', recipe, '--receipt', receipt, '--output-dir', output])
  const run = () => command(['run', '--binding', binding, '--render-receipt', receipt, '--program', 'copied',
    '--receipt', prefix + '.execution.json', '--output-dir', prefix + '.program'])
  const verify = () => command(['verify', '--binding', binding, '--render-receipt', receipt,
    '--execution-receipt', prefix + '.execution.json'])
  return { prefix, page, recipe, binding, receipt, output, command, render, run, verify }
}

const program = "import { basename } from 'node:path'\n\nconsole.log(basename('/tmp/copied.js'))"
describe('native Markdown example programs', () => {
  it('executes the native nested tilde fence, including its import, and verifies retained logs', () => {
    const selected = fixture(`1. Copy this program.\n\n   ~~~~javascript\n${program.split('\n').map((line) => '   ' + line).join('\n')}\n   ~~~~\n`)
    expect(selected.render().status).toBe(0)
    expect(selected.run().status).toBe(0)
    expect(selected.verify().status).toBe(0)
    const receipt = JSON.parse(readFileSync(selected.receipt, 'utf8'))
    expect(receipt.programs[0].files[0].text).toBe(program)
    writeFileSync(selected.prefix + '.program/.command-0.stdout', 'different result\n')
    expect(selected.verify().stderr).toContain('Execution command changed')
  })

  it('runs multiple displayed files without a hidden prelude', () => {
    const source = '```javascript\nimport value from "./value.mjs"\nconsole.log(value)\n```\n\n```javascript\nexport default "copied.js"\n```\n'
    const selected = fixture(source, { files: [{ path: 'copied.mjs', language: 'javascript', block: 0 },
      { path: 'value.mjs', language: 'javascript', block: 1 }] })
    expect(selected.render().status).toBe(0)
    expect(selected.run().status).toBe(0)
    expect(selected.verify().status).toBe(0)
  })

  it('records missing imports, wrong output and a failed earlier command as failed executions', () => {
    for (const [source, options, failure] of [
      ['console.log(basename("copied.js"))', {}, 'Example command 0 failed'],
      [program, { stdout: 'unexpected\n' }, 'Unexpected stdout'],
      [program, { commands: [[process.execPath, '-e', 'process.exit(7)'], [process.execPath, 'copied.mjs']] }, 'Example command 0 failed'],
    ] as const) {
      const selected = fixture('```javascript\n' + source + '\n```\n', options)
      expect(selected.render().status).toBe(0)
      const ran = selected.run()
      expect(ran.status).toBe(1)
      expect(ran.stderr).toContain(failure)
      expect(JSON.parse(readFileSync(selected.prefix + '.execution.json', 'utf8')).passed).toBe(false)
      expect(selected.verify().status).toBe(1)
    }
  })

  it('refuses changed source, changed HTML, old receipts and absent fences', () => {
    const selected = fixture('```javascript\n' + program + '\n```\n')
    expect(selected.render().status).toBe(0)
    expect(selected.render().status).toBe(1)
    const html = join(selected.output, 'index.html')
    const original = readFileSync(html)
    writeFileSync(html, original.toString().replace('copied.js', 'changed.js'))
    expect(selected.run().stderr).toContain('Rendered page changed')
    writeFileSync(html, original)
    writeFileSync(selected.page, '# changed source\n')
    expect(selected.run().stderr).toContain('Input changed after binding')
    const missing = fixture('# No executable fences\n')
    expect(missing.render().status).toBe(1)
    expect(JSON.parse(readFileSync(missing.receipt, 'utf8')).passed).toBe(false)
  })

  it('requires the actual revision cache used by native source inclusion to be bound', async () => {
    for (const includeCache of [false, true]) {
      const selected = fixture('```go file="examples/quickstart/main.go"\n```\n', {
        files: [{ path: 'main.go', language: 'go', block: 0 }], commands: [['go', 'run', 'main.go']], stdout: undefined,
      }, includeCache)
      const result = selected.render()
      expect(result.status).toBe(includeCache ? 0 : 1)
      if (includeCache) {
        const receipt = verifyExamplePrograms(new SourceBinding(selected.binding), selected.receipt)
        expect(receipt.record.documents[selected.page].includedSources[0].key).toBe('go:examples/quickstart/main.go')
        expect(receipt.record.programs[0].files[0].text).toContain('package main')
      } else expect(result.stderr).toContain('Input is absent from the source binding')
    }
  })

  it('rejects cached or substituted native input before collection', async () => {
    const selected = fixture('```javascript\n' + program + '\n```\n')
    const state = new ExamplePrograms(selected)
    const renderer = await createMarkdownProcessor({ syntaxHighlight: false,
      remarkPlugins: [state.inputPlugin(), remarkPortCode, state.sourcePlugin()], rehypePlugins: [state.renderedPlugin()] })
    await expect(renderer.render('```javascript\nconsole.log("substitution")\n```',
      { fileURL: pathToFileURL(selected.page) })).rejects.toThrow('Native renderer used different source')
  })

  it('keeps every rendered block identity, order, language and body through final HTML', async () => {
    const changes: Record<string, (tree: Root, blocks: Element[]) => void> = {
      unchanged: () => {},
      language: (_tree, blocks) => { (blocks[0].children[0] as Element).properties.className = ['language-typescript'] },
      missing: (_tree, blocks) => { delete blocks[0].properties.dataLibtmuxExample },
      duplicate: (tree, blocks) => { tree.children.push(structuredClone(blocks[0])) },
      order: (tree, blocks) => {
        const first = tree.children.indexOf(blocks[0])
        const second = tree.children.indexOf(blocks[1])
        ;[tree.children[first], tree.children[second]] = [blocks[1], blocks[0]]
      },
      bodies: (_tree, blocks) => { [blocks[0].children, blocks[1].children] = [blocks[1].children, blocks[0].children] },
      identities: (_tree, blocks) => {
        ;[blocks[0].properties.dataLibtmuxExample, blocks[1].properties.dataLibtmuxExample] =
          [blocks[1].properties.dataLibtmuxExample, blocks[0].properties.dataLibtmuxExample]
      },
    }
    for (const [name, change] of Object.entries(changes)) {
      const source = '```javascript\nconsole.log("first")\n```\n\n```javascript\nconsole.log("second")\n```\n'
      const selected = fixture(source)
      const state = new ExamplePrograms(selected)
      const transform = () => (tree: Root) => {
        const blocks: Element[] = []
        visit(tree, 'element', (node) => { if (node.tagName === 'pre') blocks.push(node) })
        change(tree, blocks)
      }
      const renderer = await createMarkdownProcessor({ syntaxHighlight: false,
        remarkPlugins: [state.inputPlugin(), state.sourcePlugin()], rehypePlugins: [state.renderedPlugin(), transform] })
      const rendered = await renderer.render(source, { fileURL: pathToFileURL(selected.page) })
      mkdirSync(selected.output)
      writeFileSync(join(selected.output, 'index.html'), rendered.code)
      if (name === 'unchanged') {
        state.finish(selected.output)
        expect(verifyExamplePrograms(new SourceBinding(selected.binding), selected.receipt).record.passed).toBe(true)
      } else expect(() => state.finish(selected.output), name).toThrow('Final page differs from native collected code')
    }
  })
})
