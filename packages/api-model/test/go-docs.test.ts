import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { extractWithSpec } from '../src/languages/spec.ts'
import { GO } from '../src/languages/specs.ts'

const scratch = mkdtempSync(join(tmpdir(), 'libtmux-go-docs-'))
afterEach(() => rmSync(join(scratch, 'sample.go'), { force: true }))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
const matching = 'active, err := tmuxq.Matching(snapshot.Panes(), tmux.PaneActiveIs(true))'

async function extract(comment: string) {
  const file = join(scratch, 'sample.go')
  writeFileSync(file, `package tmuxq\n\n${comment}\nfunc Matching() {}\n`)
  return (await extractWithSpec(GO, file, 'tmuxq'))[0]
}
const blocks = (body?: string) => fromMarkdown(body ?? '').children.filter((node) => node.type === 'code')

describe('native Go documentation blocks', () => {
  it('retains native indentation after the comment marker', () => {
    expect(GO.stripDoc(`//\t${matching}`)).toBe(`\t${matching}`)
    expect(GO.stripDoc(`//     ${matching}`)).toBe(`    ${matching}`)
    expect(GO.stripDoc('//go:generate go run generator.go')).toBeUndefined()
  })

  it('keeps the Matching example as Go code in its description', async () => {
    const symbol = await extract(`// Matching filters captured panes.\n//\n//\t${matching}`)
    expect(symbol.doc?.summary).toBe('Matching filters captured panes.')
    expect(blocks(symbol.doc?.body)).toMatchObject([{ lang: 'go', value: matching }])
    expect(symbol.doc?.examples).toBeUndefined()
  })

  it.each(['\t', '    '])('preserves multiline code, internal blank lines and neighboring prose with %j indentation', async (indent) => {
    const code = ['for _, pane := range panes {', '\tfmt.Println(pane.ID)', '', '\tfmt.Println(pane.Title)', '}'].join('\n')
    const comment = ['Matching prints panes.', '', 'Read the captured records:', '',
      ...code.split('\n').map((line) => line ? indent + line : ''), '',
      'Use the records after the loop.'].map((line) => `// ${line}`).join('\n')
    const doc = (await extract(comment)).doc!
    expect(doc.summary).toBe('Matching prints panes.')
    expect(blocks(doc.body)).toMatchObject([{ lang: 'go', value: code }])
    expect(doc.body!.indexOf('Read the captured records:')).toBeLessThan(doc.body!.indexOf('```go'))
    expect(doc.body!.indexOf('Use the records after the loop.')).toBeGreaterThan(doc.body!.indexOf('```go'))
  })

  it('keeps native lists separate from preformatted output', async () => {
    const symbol = await extract(['// Matching reads captured panes.', '//',
      '//  - Read one snapshot.', '//    Keep the source order.', '//  - Reuse the snapshot.', '//',
      '// Example output:', '//', '//\tNAME  STATUS', '//\tapi   ready', '//',
      '// Inspect errors before using the records.'].join('\n'))
    expect(symbol.doc!.body).toContain('- Read one snapshot.\n  Keep the source order.')
    expect(blocks(symbol.doc?.body)).toMatchObject([{ lang: 'text', value: 'NAME  STATUS\napi   ready' }])
    expect(fromMarkdown(symbol.doc!.body!).children.some((node) => node.type === 'list')).toBe(true)
  })

  it('preserves existing fenced code and comment-looking lines literally', async () => {
    const comment = ['Matching includes a shell example.', '', '```bash', '# comment', 'printf "done\\n"', '```', '',
      '\tfmt.Println("``` fence text")'].map((line) => `// ${line}`).join('\n')
    expect(blocks((await extract(comment)).doc?.body)).toMatchObject([
      { lang: 'bash', value: '# comment\nprintf "done\\n"' },
      { lang: 'go', value: 'fmt.Println("``` fence text")' },
    ])
  })

  it('preserves native block-comment indentation', async () => {
    const symbol = await extract(`/*\nMatching filters captured panes.\n\n\t${matching}\n*/`)
    expect(symbol.doc?.summary).toBe('Matching filters captured panes.')
    expect(blocks(symbol.doc?.body)).toMatchObject([{ lang: 'go', value: matching }])
  })

  it('normalizes native list markers without treating items as Go source', async () => {
    const symbol = await extract(['// Matching filters records.', '//', '//\t3) Read a snapshot.', '//\t4) Match its records.',
      '//', '// Follow the errors:', '//', '//\t• Inspect the error.', '//\t• Keep captured values.'].join('\n'))
    const lists = fromMarkdown(symbol.doc!.body!).children.filter((node) => node.type === 'list')
    expect(lists).toHaveLength(2)
    expect(lists[0]).toMatchObject({ ordered: true, start: 3 })
    expect(lists[1]).toMatchObject({ ordered: false })
    expect(blocks(symbol.doc?.body)).toEqual([])
  })
})
