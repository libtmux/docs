import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseMarkdownDocFull } from '../src/doc/markdown.ts'
import { extractWithSpec } from '../src/languages/spec.ts'
import { RUST } from '../src/languages/specs.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const block = (info: string, ...lines: string[]) => `\`\`\`${info}\n${lines.join('\n')}\n\`\`\``
const examples = (text: string, language: string) => parseMarkdownDocFull(text, language).doc.examples ?? []

describe('rustdoc info strings', () => {
  it.each([
    '', 'rust', 'no_run', 'should_panic', 'compile_fail', 'ignore', 'ignore-windows', 'test_harness', 'edition2021',
    'compile_fail,E0597', 'compile_fail,E0382', 'compile_fail,E0271', 'rust,no_run', 'rust,compile_fail,E0382',
    'no_run,edition2018', 'rust edition2021', 'should_panic, compile_fail', 'ignore,rust',
  ])('reads ```%s as Rust, with its hidden lines hidden', (info) => {
    const found = examples(`Summary.\n\n${block(info, '# use libtmux::Server;', 'shown();')}`, 'rust')
    expect(found, info).toHaveLength(1)
    expect(found[0], info).toMatchObject({ lang: 'rust', code: 'shown();' })
  })

  it.each([['console'], ['toml'], ['text,no_run'], ['sh ignore'], ['text compile_fail,E0597']])(
    'reads ```%s as the language it names and shows every line', (info) => {
      const [found] = examples(`Summary.\n\n${block(info, '# note', 'value = 1')}`, 'rust')
      expect(found).toMatchObject({ lang: info.split(/[\s,]+/)[0], code: '# note\nvalue = 1' })
    })

  it('keeps each compile_fail block apart from the prose around it', () => {
    const doc = [
      'Summary.',
      '',
      '`matching` still needs a borrowed iterator; `into_iter()` does not satisfy it:',
      '',
      block('compile_fail,E0271', 'use libtmux::query::QueryIteratorExt;', '', 'let values = vec![1, 2, 3];'),
      '',
      'Borrowed results cannot outlive their collection:',
      '',
      block('compile_fail,E0597', 'let selected = {', '    let values = vec![String::from("only")];', '};'),
      '',
      'Consuming a collection transfers ownership:',
      '',
      block('compile_fail,E0382', 'let selected = values.into_iter().one_or_none();'),
    ].join('\n')
    const parsed = parseMarkdownDocFull(doc, 'rust').doc
    expect(parsed.examples?.map((example) => example.lang)).toEqual(['rust', 'rust', 'rust'])
    // The sentences between the blocks stay prose, in order, and the code stays out of it.
    expect(parsed.summary).toBe('Summary.')
    expect(parsed.body).toBe([
      '`matching` still needs a borrowed iterator; `into_iter()` does not satisfy it:',
      '',
      'Borrowed results cannot outlive their collection:',
      '',
      'Consuming a collection transfers ownership:',
    ].join('\n'))
    expect(parsed.examples?.[1]?.code).toBe('let selected = {\n    let values = vec![String::from("only")];\n};')
  })

  it('reaches the model through extraction', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fence-info-'))
    dirs.push(dir)
    const file = join(dir, 'lib.rs')
    writeFileSync(file, '/// Borrow it.\n///\n/// ```compile_fail,E0597\n/// # use libtmux::Server;\n/// let selected = {\n///     values.iter().exactly_one().unwrap()\n/// };\n/// ```\npub fn borrow() {}\n')
    const [symbol] = await extractWithSpec(RUST, file, 'm')
    expect(symbol.doc?.examples).toEqual([{ lang: 'rust', code: 'let selected = {\n    values.iter().exactly_one().unwrap()\n};', intro: undefined }])
  })
})

describe('other info strings', () => {
  it('takes the language from the first word and ignores the rest', () => {
    for (const [info, lang] of [['ts title="install"', 'ts'], ['sh {1,3}', 'sh'], ['python, linenos', 'python']]) {
      expect(examples(`Summary.\n\n${block(info, 'a', '  b')}`, 'typescript')[0], info).toMatchObject({ lang, code: 'a\n  b' })
    }
  })

  it('falls back to the doc language when only attributes are given', () => {
    expect(examples(`Summary.\n\n${block('ignore', 'a')}`, 'typescript')[0]?.lang).toBe('typescript')
    expect(examples(`Summary.\n\n${block('rust,no_run', '# note', 'a')}`, 'typescript')[0]).toMatchObject({ lang: 'rust', code: '# note\na' })
  })

  it('leaves a line of inline code as prose', () => {
    const doc = parseMarkdownDocFull('Summary.\n\nSee ```inline``` and ``` two ``` here.\n\n```ts\ncode()\n```', 'typescript').doc
    expect(doc.examples?.map((example) => example.code)).toEqual(['code()'])
    expect(doc.body).toContain('See ```inline``` and ``` two ``` here.')
  })
})
