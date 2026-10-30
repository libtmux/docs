import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, describe, expect, it } from 'vitest'
import { CODE_COLUMNS } from '../src/lib/code-layout'
import {
  measureExampleColumns, ratchetProblems, renamePages, wideLines, type ExampleColumns,
} from '../src/lib/example-columns'

/**
 * Code in examples stays within `CODE_COLUMNS.example`, ratcheted per page.
 *
 * The baseline records the lines each page has over the budget today. The
 * first block checks the real content tree against it and nothing else, so a
 * regression there fails one test. The rest plant failures in synthetic
 * pages, so the check is shown to fail rather than assumed to.
 */
const CONTENT = fileURLToPath(new URL('../src/content/docs/', import.meta.url))
const BASELINE = fileURLToPath(new URL('./fixtures/example-columns.json', import.meta.url))
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../../scripts/gen-example-columns.mjs')
const fence = (language: string, ...lines: string[]) => `\`\`\`${language}\n${lines.join('\n')}\n\`\`\`\n`
const limit = CODE_COLUMNS.example
const long = 'x'.repeat(limit + 1)

const scratch: string[] = []
afterAll(() => {
  scratch.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

/** A content tree holding the given pages, by path. */
function tree(pages: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'libtmux-columns-'))
  scratch.push(root)
  for (const [page, markdown] of Object.entries(pages)) {
    mkdirSync(dirname(join(root, page)), { recursive: true })
    writeFileSync(join(root, page), markdown)
  }
  return root
}

describe('the content tree', () => {
  it('matches the recorded baseline', async () => {
    const baseline: ExampleColumns = JSON.parse(readFileSync(BASELINE, 'utf8'))
    expect(ratchetProblems(await measureExampleColumns(CONTENT), baseline),
      'shorten the added lines; after a page shrinks, run node scripts/gen-example-columns.mjs').toEqual([])
  })
})

describe('the budget', () => {
  it('fails an 81-column line in a page the baseline lacks', async () => {
    const root = tree({ 'guides/new.md': fence('go', long) })
    const measured = await measureExampleColumns(root)
    expect(measured).toEqual({ 'guides/new.md': 1 })
    expect(ratchetProblems(measured, {})).toEqual([`guides/new.md: 1 lines over ${limit} columns, and the page is not in the baseline`])
  })

  it('passes an 80-column line', async () => {
    const root = tree({ 'guides/new.md': fence('go', 'x'.repeat(limit)) })
    expect(await measureExampleColumns(root)).toEqual({})
  })

  it('passes a wide-glyph line within the budget and fails one past it', async () => {
    // Each of these glyphs prints two columns wide.
    const within = '界'.repeat(limit / 2)
    expect(await wideLines(fence('py', within))).toEqual([])
    expect(await wideLines(fence('py', `${within}界`))).toEqual([{ line: 2, columns: limit + 2 }])
  })

  it('counts a tab as eight columns', async () => {
    expect(await wideLines(fence('go', `\t${'x'.repeat(limit - 8)}`))).toEqual([])
    expect(await wideLines(fence('go', `\t${'x'.repeat(limit - 7)}`))).toEqual([{ line: 2, columns: limit + 1 }])
  })

  it('fails growth in a baselined page', async () => {
    const root = tree({ 'ports/go/guides/a.md': fence('go', long, long) })
    const measured = await measureExampleColumns(root)
    expect(ratchetProblems(measured, { 'ports/go/guides/a.md': 1 }))
      .toEqual([`ports/go/guides/a.md: 2 lines over ${limit} columns, the baseline allows 1`])
    expect(ratchetProblems(measured, { 'ports/go/guides/a.md': 2 })).toEqual([])
  })

  it('fails a shrink until the baseline is lowered', async () => {
    const root = tree({ 'ports/go/guides/a.md': fence('go', long), 'ports/go/guides/b.md': fence('go', 'ok') })
    const measured = await measureExampleColumns(root)
    expect(ratchetProblems(measured, { 'ports/go/guides/a.md': 3, 'ports/go/guides/b.md': 1 })).toEqual([
      `ports/go/guides/a.md: 1 lines over ${limit} columns, the baseline still records 3`,
      `ports/go/guides/b.md: 0 lines over ${limit} columns, the baseline still records 1`,
    ])
  })

  it('refuses a baseline entry that is not a positive whole number', () => {
    expect(ratchetProblems({}, { 'a.md': 0 })).toContain('a.md: a baseline entry is a positive whole number of lines, not 0')
  })

  it('reads every locale, port and MDX page, and not staged copies', async () => {
    const page = fence('ts', long)
    const root = tree({
      'ja/index.md': page, 'meta/page.mdx': page, 'ports/elixir/deep/er/page.md': page,
      '_staged/fsharp/guide.md': page, 'notes.txt': page,
    })
    expect(Object.keys(await measureExampleColumns(root))).toEqual(['ja/index.md', 'meta/page.mdx', 'ports/elixir/deep/er/page.md'])
  })
})

describe('code blocks', () => {
  it.each([
    ['indented four spaces in a list item', `- item\n\n    \`\`\`go\n    ${long}\n    \`\`\`\n`, 4],
    ['in a nested list', `1. one\n   - two\n\n     \`\`\`go\n     ${long}\n     \`\`\`\n`, 5],
    ['after a quotation marker', `> \`\`\`go\n> ${long}\n> \`\`\`\n`, 2],
    ['a tilde fence', `~~~go\n${long}\n~~~\n`, 2],
    ['a fence that is never closed', `\`\`\`go\n${long}\n`, 2],
    ['an indented code block', `Prose.\n\n    ${long}\n`, 3],
    ['a fence after front matter', `---\ntitle: ${long}\n---\n\n\`\`\`go\n${long}\n\`\`\`\n`, 6],
  ])('measures %s', async (_kind, markdown, line) => {
    expect(await wideLines(markdown)).toEqual([{ line, columns: limit + 1 }])
  })

  it('reports the line in the page, not in the fence', async () => {
    expect(await wideLines(`# Title\n\nProse.\n\n${fence('go', 'short', long)}`)).toEqual([{ line: 7, columns: limit + 1 }])
  })

  it('measures included fences nowhere, as they hold no text of their own', async () => {
    expect(await wideLines('```go file="examples/main.go"\n```\n')).toEqual([])
  })

  it('does not read prose or inline code as a block', async () => {
    expect(await wideLines(`${long}\n\n\`${long}\`\n`)).toEqual([])
  })
})

describe('fence classes', () => {
  const wide = 'x'.repeat(limit + 20)

  it.each(['go', 'sh', 'bash', 'rust', 'xml', 'toml', 'markdown', 'rst', 'json', 'text', 'unlabelled'])('counts a %s fence', async (language) => {
    expect(await wideLines(fence(language === 'unlabelled' ? '' : language, wide))).toHaveLength(1)
  })

  it.each(['output', 'log'])('leaves recorded output in a %s fence', async (language) => {
    expect(await wideLines(fence(language, wide))).toEqual([])
  })

  it.each(['console', 'shellsession'])('counts the commands of a %s session and leaves its output', async (language) => {
    expect(await wideLines(fence(language, `$ echo ${wide}`, wide))).toEqual([{ line: 2, columns: 2 + 'echo '.length + wide.length }])
    expect(await wideLines(fence(language, '$ echo ok', wide))).toEqual([])
  })

  it('counts every line of a console block that has no prompt', async () => {
    expect(await wideLines(fence('console', wide))).toHaveLength(1)
  })

  it('counts the continuation lines of a command', async () => {
    expect(await wideLines(fence('console', '$ git fetch \\', `    ${wide} \\`, '    origin', wide)))
      .toEqual([{ line: 3, columns: 4 + wide.length + 2 }])
  })
})

describe('renamePages', () => {
  const measured = (count: number): ExampleColumns => ({ 'new.md': count })

  it('moves an entry to the page that replaced it', () => {
    expect(renamePages({ 'old.md': 3, 'other.md': 1 }, measured(3), [['old.md', 'new.md']]))
      .toEqual({ baseline: { 'other.md': 1, 'new.md': 3 }, problems: [] })
  })

  it('moves an entry to a page that has fewer lines over', () => {
    expect(renamePages({ 'old.md': 3 }, measured(2), [['old.md', 'new.md']]).problems).toEqual([])
    expect(renamePages({ 'old.md': 3 }, {}, [['old.md', 'new.md']]).problems).toEqual([])
  })

  it('refuses a page that has more lines over than the entry recorded', () => {
    expect(renamePages({ 'old.md': 3 }, measured(4), [['old.md', 'new.md']])).toEqual({
      baseline: { 'old.md': 3 },
      problems: [`new.md: 4 lines over ${limit} columns, more than the 3 that old.md recorded`],
    })
  })

  it('refuses an entry that does not exist and a page that already has one', () => {
    expect(renamePages({ 'a.md': 1 }, {}, [['old.md', 'new.md']]).problems).toEqual(['old.md: no baseline entry to rename'])
    expect(renamePages({ 'old.md': 1, 'new.md': 1 }, measured(1), [['old.md', 'new.md']]).problems)
      .toEqual(['new.md: already has a baseline entry'])
  })
})

describe('gen-example-columns', () => {
  const run = async (content: string, baseline: string, ...flags: string[]) => {
    try {
      const { stdout } = await promisify(execFile)(process.execPath, [SCRIPT, '--content', content, '--baseline', baseline, ...flags])
      return { status: 0, output: stdout }
    } catch (error) {
      const { code, stdout, stderr } = error as { code: number; stdout: string; stderr: string }
      return { status: code, output: `${stdout}${stderr}` }
    }
  }
  const recorded = (entries: ExampleColumns) => {
    const file = join(tree({}), 'baseline.json')
    writeFileSync(file, JSON.stringify(entries))
    return file
  }
  const written = (baseline: string) => JSON.parse(readFileSync(baseline, 'utf8')) as ExampleColumns

  it.concurrent('lowers the baseline to what the tree measures', async () => {
    const content = tree({ 'a.md': fence('go', long) })
    const baseline = recorded({ 'a.md': 4, 'gone.md': 2 })
    expect((await run(content, baseline)).status).toBe(0)
    expect(written(baseline)).toEqual({ 'a.md': 1 })
  })

  it.concurrent('refuses to raise a count, and leaves the baseline alone', async () => {
    const content = tree({ 'a.md': fence('go', long, long) })
    const baseline = recorded({ 'a.md': 1 })
    const refused = await run(content, baseline)
    expect(refused.status).toBe(1)
    expect(refused.output).toContain('a.md: 1 -> 2')
    expect(written(baseline)).toEqual({ 'a.md': 1 })
    expect((await run(content, baseline, '--force')).status).toBe(0)
    expect(written(baseline)).toEqual({ 'a.md': 2 })
  })

  it.concurrent('refuses a page the baseline does not list, and a missing baseline', async () => {
    const content = tree({ 'a.md': fence('go', long) })
    const baseline = join(tree({}), 'baseline.json')
    const refused = await run(content, baseline)
    expect(refused.status).toBe(1)
    expect(refused.output).toContain('a.md: 0 -> 1')
    expect((await run(content, baseline, '--force')).status).toBe(0)
  })

  it.concurrent('carries a renamed page with --rename and no --force', async () => {
    const content = tree({ 'new.md': fence('go', long, long, long), 'other.md': fence('go', long) })
    const baseline = recorded({ 'old.md': 3, 'other.md': 1 })
    expect((await run(content, baseline)).output).toContain('new.md: 0 -> 3')
    expect((await run(content, baseline, '--rename', 'old.md=new.md')).status).toBe(0)
    expect(written(baseline)).toEqual({ 'new.md': 3, 'other.md': 1 })
  })

  it.concurrent('lets no growth through beside a rename', async () => {
    const content = tree({ 'new.md': fence('go', long, long, long), 'other.md': fence('go', long, long) })
    const baseline = recorded({ 'old.md': 3, 'other.md': 1 })
    const refused = await run(content, baseline, '--rename', 'old.md=new.md')
    expect(refused.status).toBe(1)
    expect(refused.output).toContain('other.md: 1 -> 2')
    expect(written(baseline)).toEqual({ 'old.md': 3, 'other.md': 1 })
  })

  it.concurrent('refuses a rename onto a page that has more lines over', async () => {
    const content = tree({ 'new.md': fence('go', long, long, long, long) })
    const baseline = recorded({ 'old.md': 3 })
    const refused = await run(content, baseline, '--rename', 'old.md=new.md')
    expect(refused.status).toBe(1)
    expect(refused.output).toContain('more than the 3 that old.md recorded')
    expect(written(baseline)).toEqual({ 'old.md': 3 })
  })
})
