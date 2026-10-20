import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { experimental_AstroContainer } from 'astro/container'
import { Window } from 'happy-dom'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { describe, expect, it } from 'vitest'
import { parameterId, SymbolIndex, type ApiSymbol, type Param } from '@libtmux/api-model'
import { apiEntryFields, nativeSignatureText, usesNativeSignatures } from '../src/lib/api-sections'
import { apiSignatureLayouts, CODE_COLUMNS, codeWidthFailures, signatureSpans, supportsCSignatures, type CodeLayout } from '../src/lib/code-layout'
import { formatCDeclaration, formatCEnumDeclaration } from '../src/lib/cxx-code-layout'
import { symbolMarkdownWithLayout } from '../src/lib/symbol-markdown'
import { tmuxReferenceIndex, tmuxSourceModel } from '../src/lib/tmux-reference'
import { displayedSignature, signatureComponent } from './signature-component'

interface Case { group: string; columns: number; clangColumnLimit: number; raw: string; text: string }
const fixture = JSON.parse(readFileSync(new URL('./fixtures/c-clang-format.json', import.meta.url), 'utf8')) as {
  formatter: string
  cases: Case[]
}
const VERSIONS = ['3.2a', '3.7c'] as const
const model = tmuxSourceModel('latest')
const index = tmuxReferenceIndex('latest')
const find = (name: string, kind = 'function') => {
  const symbol = model.symbols.find((entry) => entry.name === name && entry.kind === kind)
  expect(symbol, name).toBeDefined()
  return symbol!
}
const layoutOf = async (symbol: ApiSymbol, overload = 0): Promise<CodeLayout> => {
  const layout = (await apiSignatureLayouts(symbol, 'c')).get(symbol.signatures[overload]!)
  expect(layout, symbol.id).toBeDefined()
  return layout!
}
const callable = (raw: string, params: Param[] = [], name = 'probe', kind: ApiSymbol['kind'] = 'function'): ApiSymbol => ({
  id: `c:${kind}:${name}`, name, kind, modifiers: [], signatures: [{ raw, params }], source: { file: 'probe.c' },
})

const EXAMPLE = {
  raw: 'static void cmd_list_panes_window(struct cmd *, struct session *, struct winlink *, struct cmdq_item *, int)',
  text: [
    'static void cmd_list_panes_window(struct cmd *,',
    '                                  struct session *,',
    '                                  struct winlink *,',
    '                                  struct cmdq_item *, int)',
  ].join('\n'),
}

/**
 * Why a wrapped parameter list is not aligned the way clang-format aligns it. A line that follows a
 * comma starts one column after the `(` still open, or, when that `(` ends its line, where the first
 * parameter below it started.
 */
function alignmentFailures(text: string): string[] {
  const lines = text.split('\n')
  const failures: string[] = []
  const open: { column: number; hanging: boolean; indent?: number }[] = []
  lines.forEach((line, at) => {
    const indent = line.length - line.trimStart().length
    const top = open.at(-1)
    if (at > 0 && top && /[,(]$/.test(lines[at - 1]!)) {
      if (top.hanging) {
        top.indent ??= indent
        if (indent !== top.indent) failures.push(`line ${at + 1} starts at column ${indent}, the parameters above start at ${top.indent}`)
      } else if (indent !== top.column + 1) failures.push(`line ${at + 1} starts at column ${indent}, expected ${top.column + 1}`)
    }
    for (let column = 0; column < line.length; column++) {
      if (line[column] === '(') open.push({ column, hanging: line.slice(column + 1).trim() === '' })
      else if (line[column] === ')') open.pop()
    }
  })
  return failures
}

describe('the cmd_list_panes_window example', () => {
  it('packs parameters onto a line while it stays within 60 columns, aligned one column after the parenthesis', async () => {
    expect(formatCDeclaration(EXAMPLE.raw, 60)).toBe(EXAMPLE.text)
    const symbol = find('cmd_list_panes_window')
    expect(symbol.signatures[0]!.raw).toBe(EXAMPLE.raw)
    const layout = await layoutOf(symbol)
    expect(layout.text).toBe(EXAMPLE.text)
    expect(layout.limit).toBe(60)
    expect(layout.failures).toEqual([])
    // "struct session *, struct winlink *," cannot join its line, and "struct cmdq_item *, int)" can.
    const column = EXAMPLE.text.indexOf('(') + 1
    expect(column + 'struct session *, struct winlink *,'.length).toBeGreaterThan(60)
    expect(column + 'struct cmdq_item *, int)'.length).toBeLessThanOrEqual(60)
    expect(alignmentFailures(layout.text)).toEqual([])
  })

  it('is what the Markdown export prints', async () => {
    const symbol = find('cmd_list_panes_window')
    expect(usesNativeSignatures(symbol, 'c')).toBe(true)
    const markdown = await symbolMarkdownWithLayout({ model, symbol, index })
    const code = fromMarkdown(markdown).children.find((node) => node.type === 'code')
    expect(code?.type === 'code' && [code.lang, code.value]).toEqual(['c', EXAMPLE.text])
  })

  it('is the declaration on the page: formatted, within the budget, with its links', async () => {
    const symbol = find('cmd_list_panes_window')
    const signatureLayouts = await apiSignatureLayouts(symbol, 'c')
    const container = await experimental_AstroContainer.create()
    const win = new Window()
    try {
      win.document.body.innerHTML = await container.renderToString(await signatureComponent(), {
        props: { symbol, sig: symbol.signatures[0], language: 'c', index, signatureLayouts, nativeSignatureText },
      })
      const signature = win.document.querySelector('.api-native-signature')!
      expect(displayedSignature(signature)).toBe(EXAMPLE.text)
      expect(signature.classList.contains('api-native-signature--formatted')).toBe(true)
      expect(signature.getAttribute('data-code-columns')).toBe('60')
      expect(signature.getAttribute('data-code-width-status')).toBe('fits')
      expect(signature.hasAttribute('data-code-width-failures')).toBe(false)
      expect(signature.querySelector('.api-declaration-name')?.textContent).toBe('cmd_list_panes_window')
      // The raw declaration names no parameter, so none is linked; each struct links to its page.
      expect(signature.querySelector('a.api-parameter-name')).toBeNull()
      expect([...signature.querySelectorAll('a.api-type-link')].map((link) => link.textContent))
        .toEqual(['cmd', 'session', 'winlink', 'cmdq_item'])
    } finally { await win.happyDOM.abort() }
  })
})

describe('C layouts reproduce pinned clang-format output', () => {
  it('records the formatter and exercises every declaration shape the reference holds', () => {
    expect(fixture.formatter).toMatch(/^Ubuntu clang-format version 21\./)
    const groups = new Set(fixture.cases.map((entry) => entry.group))
    for (const group of ['corpus', 'budget', 'example', 'fits', 'fits-exactly-60', 'wraps-at-61', 'function-pointer', 'varargs', 'return-type',
      'array', 'qualifiers', 'pointer-spacing', 'long-parameter', 'typedef', 'member', 'enum']) expect(groups, group).toContain(group)
    // Both stand-ins for an omitted `;` are in use, and a declaration that ends in `;` is formatted as written.
    expect(fixture.cases.some((entry) => !entry.raw.endsWith(';') && entry.clangColumnLimit === entry.columns + 1)).toBe(true)
    expect(fixture.cases.some((entry) => !entry.raw.endsWith(';') && entry.clangColumnLimit === entry.columns)).toBe(true)
    expect(fixture.cases.every((entry) => !entry.raw.endsWith(';') || entry.clangColumnLimit === entry.columns)).toBe(true)
  })

  it.each([...new Set(fixture.cases.map((entry) => `${entry.group}@${entry.columns}`))])('matches the %s cases', (selection) => {
    const [group, columns] = selection.split('@')
    const cases = fixture.cases.filter((entry) => entry.group === group && entry.columns === Number(columns))
    expect(cases.length).toBeGreaterThan(0)
    const failed = cases.flatMap((entry) => {
      const text = entry.group === 'enum' ? formatCEnumDeclaration(entry.raw, entry.columns) : formatCDeclaration(entry.raw, entry.columns)
      return text === entry.text ? [] : [{ raw: entry.raw, expected: entry.text, actual: text }]
    })
    expect(failed).toEqual([])
  })

  it('is sensitive to the budget, so the fixture exercises the search', () => {
    const wrapped = fixture.cases.filter((entry) => entry.group !== 'enum' && entry.columns === 60 && entry.text.includes('\n'))
    expect(wrapped.length).toBeGreaterThan(fixture.cases.filter((entry) => entry.columns === 60).length / 2)
    for (const entry of wrapped.slice(0, 20)) expect(formatCDeclaration(entry.raw, 200)).not.toBe(entry.text)
    // Taking a column away moves a break in the cases that sit at the limit.
    const edge = fixture.cases.filter((entry) => entry.columns === 60 && !entry.raw.endsWith(';') && entry.clangColumnLimit === 61 &&
      entry.text.split('\n').some((line) => line.length === 60))
    expect(edge.length).toBeGreaterThan(0)
    for (const entry of edge) expect(formatCDeclaration(entry.raw, 59)).not.toBe(entry.text)
  })

  it('keeps the omitted `;` out of the budget: a declaration of exactly 60 columns stays whole', () => {
    const raw = 'void args_set(struct args *args, u_char flag, const char *s)'
    expect(raw).toHaveLength(60)
    expect(formatCDeclaration(raw, 60)).toBe(raw)
    expect(formatCDeclaration(`${raw};`, 60)).toBe(`void args_set(struct args *args, u_char flag,\n              const char *s);`)
    expect(formatCDeclaration(raw.replace('*s)', '*s2)'), 60)).toBe('void args_set(struct args *args, u_char flag,\n              const char *s2)')
  })
})

describe('C layout rules', () => {
  it('leaves a declaration that fits as it is, at its own pointer spacing', async () => {
    for (const raw of ['static int alerts_enabled(struct window *, int)', 'struct args *args_create(void)', 'int BSDgetopt(int, char *const *, const char *)']) {
      expect(formatCDeclaration(raw, 60), raw).toBe(raw)
    }
    const layout = await layoutOf(find('alerts_enabled'))
    expect(layout.text).toBe(find('alerts_enabled').signatures[0]!.raw)
    expect(layout.failures).toEqual([])
  })

  it('writes the pointer against the name, as tmux does', () => {
    expect(formatCDeclaration('struct cmd_list * args_make_commands(struct args_command_state *state, int argc, char **argv, char **cause)', 60))
      .toBe('struct cmd_list *\nargs_make_commands(struct args_command_state *state,\n                   int argc, char **argv, char **cause)')
    expect(formatCDeclaration('static const char * cmd_find_map_table(const char *[][2], const char *)', 60))
      .toBe('static const char *cmd_find_map_table(const char *[][2],\n                                      const char *)')
    expect(formatCDeclaration('void (*command)(char ** argv, const char * fmt,...);', 60)).toBe('void (*command)(char **argv, const char *fmt, ...);')
  })

  it('keeps a function-pointer parameter whole and aligns inside it', async () => {
    const layout = await layoutOf(find('format_each'))
    expect(layout.text).toBe([
      'void format_each(struct format_tree *ft,',
      '                 void (*cb)(const char *, const char *,',
      '                            void *),',
      '                 void *arg)',
    ].join('\n'))
    expect(alignmentFailures(layout.text)).toEqual([])
    expect(layout.failures).toEqual([])
    // The pointer's own name is the parameter the model lists, and the declarator is not mistaken for a function name.
    const symbol = find('format_each')
    const spans = signatureSpans(layout, index, symbol, symbol.signatures[0])
    expect(spans.filter((span) => span.declarationName).map((span) => span.text)).toEqual(['format_each'])
    expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => span.text)).toEqual(['ft', 'cb', 'arg'])
  })

  it('spaces a variadic marker after its comma and counts it as a parameter', async () => {
    const symbol = find('args_print_add')
    expect(symbol.signatures[0]!.raw).toBe('static void args_print_add(char **buf, size_t *len, const char *fmt,...)')
    const layout = await layoutOf(symbol)
    expect(layout.text).toBe('static void args_print_add(char **buf, size_t *len,\n                           const char *fmt, ...)')
    // The model lists the marker as an unnamed fourth parameter, so only the named three can be linked.
    expect(symbol.signatures[0]!.params.map((param) => param.name)).toEqual(['buf', 'len', 'fmt', ''])
    const spans = signatureSpans(layout, index, symbol, symbol.signatures[0])
    expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => span.text)).toEqual(['buf', 'len', 'fmt'])
  })

  it('puts a long return type on its own line before it wraps the parameters', () => {
    expect(formatCDeclaration('enum cmd_retval cmd_attach_session(struct cmdq_item *item, const char *tflag, int dflag, int xflag, int rflag, const char *cflag, int Eflag, const char *fflag)', 60))
      .toBe([
        'enum cmd_retval',
        'cmd_attach_session(struct cmdq_item *item,',
        '                   const char *tflag, int dflag, int xflag,',
        '                   int rflag, const char *cflag, int Eflag,',
        '                   const char *fflag)',
      ].join('\n'))
  })

  it('breaks after the parenthesis and indents when one parameter will not share the line', async () => {
    const raw = 'static enum window_copy_cmd_action window_copy_cmd_scroll_bottom(struct window_copy_cmd_state *cs)'
    const text = 'static enum window_copy_cmd_action\nwindow_copy_cmd_scroll_bottom(\n    struct window_copy_cmd_state *cs)'
    expect(formatCDeclaration(raw, 60)).toBe(text)
    const symbol = find('window_copy_cmd_scroll_bottom')
    expect(symbol.signatures[0]!.raw).toBe(raw)
    expect((await layoutOf(symbol)).text).toBe(text)
    expect(alignmentFailures(text)).toEqual([])
    // A parameter alone wider than the budget breaks inside itself, before its `*`, and the name stays whole.
    const wide = 'int tty_term_describe_the_capability(struct tty_term *term, const char *a_parameter_type_that_is_fairly_long_indeed_x, int quiet)'
    expect(formatCDeclaration(wide, 60)).toBe([
      'int tty_term_describe_the_capability(',
      '    struct tty_term *term,',
      '    const char',
      '        *a_parameter_type_that_is_fairly_long_indeed_x,',
      '    int quiet)',
    ].join('\n'))
  })

  it('records an indivisible over-width token without splitting it', async () => {
    const tag = `a_structure_${'whose_name_is_far_wider_than_the_budget_'.repeat(2)}x`
    expect(tag.length).toBeGreaterThan(CODE_COLUMNS.api)
    const symbol = callable(`void probe(struct ${tag} *value)`, [{ name: 'value', type: `struct ${tag} *` }])
    const layout = await layoutOf(symbol)
    expect(layout.text).toContain(`\n    ${tag}\n`)
    expect(layout.failures).toEqual(await codeWidthFailures(layout.text, 'api'))
    expect(layout.failures.map((failure) => failure.line)).toEqual([3])
    expect(layout.text.replace(/\s+/g, '')).toBe(symbol.signatures[0]!.raw!.replace(/\s+/g, ''))
    const container = await experimental_AstroContainer.create()
    const win = new Window()
    try {
      win.document.body.innerHTML = await container.renderToString(await signatureComponent(), {
        props: { symbol, sig: symbol.signatures[0], language: 'c', index: new SymbolIndex([symbol], () => '/probe/', 'c'), signatureLayouts: new Map([[symbol.signatures[0]!, layout]]), nativeSignatureText },
      })
      const signature = win.document.querySelector('.api-native-signature')!
      expect(signature.getAttribute('data-code-width-status')).toBe('unresolved')
      expect(JSON.parse(signature.getAttribute('data-code-width-failures')!)).toEqual(layout.failures)
    } finally { await win.happyDOM.abort() }
  })

  it('lays out a function-pointer typedef and member as clang-format does, and links the declared name', async () => {
    const typedef = find('mode_tree_draw_cb', 'typealias')
    const typedefLayout = await layoutOf(typedef)
    expect(typedefLayout.text).toBe([
      'typedef void (*mode_tree_draw_cb)(void *, void *,',
      '                                  struct screen_write_ctx *,',
      '                                  u_int, u_int);',
    ].join('\n'))
    expect(alignmentFailures(typedefLayout.text)).toEqual([])
    const member = model.symbols.find((entry) => entry.id === 'c:struct:window_mode::command' || (entry.name === 'command' && entry.parent === 'c:struct:window_mode'))!
    const memberLayout = await layoutOf(member)
    expect(memberLayout.text).toBe([
      'void (*command)(struct window_mode_entry *, struct client *,',
      '                struct session *, struct winlink *,',
      '                struct args *, struct mouse_event *);',
    ].join('\n'))
    for (const [symbol, layout] of [[typedef, typedefLayout], [member, memberLayout]] as const) {
      const spans = signatureSpans(layout, index, symbol, symbol.signatures[0])
      expect(spans.filter((span) => span.declarationName).map((span) => span.text), symbol.id).toEqual([symbol.name])
      // The model lists no parameters for these, so none is bound.
      expect(spans.filter((span) => span.link?.href.startsWith('#')), symbol.id).toEqual([])
    }
  })

  it('lays out an enum that does not fit with one enumerator per line, and keeps one that fits', async () => {
    const wide = find('cmd_retval', 'enum')
    expect(wide.signatures[0]!.raw!.length).toBeGreaterThan(60)
    const layout = await layoutOf(wide)
    expect(layout.text).toBe('enum cmd_retval {\n  CMD_RETURN_ERROR = -1,\n  CMD_RETURN_NORMAL = 0,\n  CMD_RETURN_WAIT,\n  CMD_RETURN_STOP\n};')
    expect(signatureSpans(layout, index, wide, wide.signatures[0]).filter((span) => span.declarationName).map((span) => span.text)).toEqual(['cmd_retval'])
    expect(formatCEnumDeclaration('enum cmdq_type { CMDQ_COMMAND, CMDQ_CALLBACK };', 60)).toBe('enum cmdq_type { CMDQ_COMMAND, CMDQ_CALLBACK };')
    // An anonymous enum has no tag to mark; the terminator the extractor leaves off stays off.
    expect(formatCEnumDeclaration('enum { OFF, MOVE, SIZE }', 60)).toBe('enum { OFF, MOVE, SIZE }')
    const anonymous = callable('enum { FIRST_WIDE_ENUMERATOR, SECOND_WIDE_ENUMERATOR, THIRD_WIDE_ENUMERATOR };', [], 'anonymous enum', 'enum')
    const anonymousLayout = await layoutOf(anonymous)
    expect(anonymousLayout.text).toBe('enum {\n  FIRST_WIDE_ENUMERATOR,\n  SECOND_WIDE_ENUMERATOR,\n  THIRD_WIDE_ENUMERATOR\n};')
    expect(anonymousLayout.syntax).toEqual([])
  })
})

describe('C layout negative controls', () => {
  it('rejects a continuation line one column off the parenthesis, in either direction', () => {
    const lines = EXAMPLE.text.split('\n')
    expect(alignmentFailures(EXAMPLE.text)).toEqual([])
    for (const shift of [-1, 1]) {
      for (const at of [1, 2, 3]) {
        const moved = lines.map((line, i) => i === at ? (shift < 0 ? line.slice(1) : ` ${line}`) : line).join('\n')
        expect(alignmentFailures(moved), `${shift} on line ${at + 1}`).toHaveLength(1)
      }
    }
    // The same rule holds when the parameters hang below the parenthesis.
    const hanging = 'int tty_term_describe_the_capability(\n    struct tty_term *term,\n    const char *x,\n    int quiet)'
    expect(alignmentFailures(hanging)).toEqual([])
    expect(alignmentFailures(hanging.replace('\n    int quiet', '\n     int quiet'))).toHaveLength(1)
  })

  it('rejects a line over 60 columns', async () => {
    const over = EXAMPLE.text.replace('struct winlink *,', 'struct winlink *, struct more *,')
    const failures = await codeWidthFailures(over, 'api')
    expect(failures).toEqual([{ line: 3, columns: 66, limit: 60 }])
    expect(await codeWidthFailures(EXAMPLE.text, 'api')).toEqual([])
    // A line exactly at the limit is within it.
    expect(await codeWidthFailures('x'.repeat(60), 'api')).toEqual([])
    expect(await codeWidthFailures('x'.repeat(61), 'api')).toHaveLength(1)
  })

  it('refuses grammar it does not read instead of guessing a layout', () => {
    expect(() => formatCDeclaration('int count = 1', 60)).toThrow(/operator =/)
    expect(() => formatCDeclaration('void f(int a', 60)).toThrow(/brackets/)
    expect(() => formatCDeclaration('int value;', 60)).toThrow(/parameter list/)
    expect(() => formatCDeclaration('void f(void (*cb)(int)', 60)).toThrow(/brackets/)
    expect(() => formatCEnumDeclaration('enum x { A = (1 << 2), B };', 60)).toThrow(/enumerator/)
  })

  it('rejects stale model bindings', async () => {
    await expect(apiSignatureLayouts(callable('void other(int value)', [{ name: 'value' }]), 'c')).rejects.toThrow(/name does not match/)
    await expect(apiSignatureLayouts(callable('void probe(int value)', [{ name: 'value' }, { name: 'extra' }]), 'c')).rejects.toThrow(/parameter list does not match/)
  })
})

describe('every tmux declaration the C layout reads', () => {
  it.each(VERSIONS)('lays out tmux %s within the budget, whole and aligned, with its roles intact', async (version) => {
    const source = tmuxSourceModel(version)
    const versionIndex = tmuxReferenceIndex(version)
    let checked = 0
    let wrapped = 0
    const kinds = new Set<string>()
    for (const symbol of source.symbols) {
      if (!supportsCSignatures(symbol, 'c')) continue
      const layouts = await apiSignatureLayouts(symbol, 'c')
      for (const signature of symbol.signatures) {
        const layout = layouts.get(signature)!
        expect(layout, symbol.id).toBeDefined()
        checked++
        kinds.add(symbol.kind)
        expect(layout.limit).toBe(CODE_COLUMNS.api)
        expect(layout.failures, symbol.id).toEqual(await codeWidthFailures(layout.text, 'api'))
        // Only whitespace changes, so tokens, punctuation and names stay intact.
        expect(layout.text.replace(/\s+/g, ''), symbol.id).toBe(signature.raw!.replace(/\s+/g, ''))
        expect(layout.text.split('\n').every((line) => line.length <= CODE_COLUMNS.api) || layout.failures.length > 0, symbol.id).toBe(true)
        if (symbol.kind !== 'enum') expect(alignmentFailures(layout.text), symbol.id).toEqual([])
        // A laid-out declaration is a fixed point, and it adds no `;` the source did not write.
        expect((symbol.kind === 'enum' ? formatCEnumDeclaration : formatCDeclaration)(layout.text, CODE_COLUMNS.api), symbol.id).toBe(layout.text)
        expect(layout.text.endsWith(';'), symbol.id).toBe(signature.raw!.trim().endsWith(';'))
        const spans = signatureSpans(layout, versionIndex, symbol, signature)
        expect(spans.map((span) => span.text).join(''), symbol.id).toBe(layout.text)
        expect(spans.filter((span) => span.declarationName).map((span) => span.text), symbol.id)
          .toEqual(/^[A-Za-z_]\w*$/.test(symbol.name) ? [symbol.name] : [])
        // A parameter is linked where the declaration spells the name the model gives it, and nowhere else.
        const declared = signature.params.map((param) => param.name).filter((name) =>
          name && new RegExp(`(?:[\\s*]|\\(\\*)(?<!\\b(?:struct|enum|union)\\s)${name}(?:\\[[^\\]]*\\])*\\s*[,)]`).test(signature.raw!))
        const links = spans.filter((span) => span.link?.href.startsWith('#'))
        expect(links.map((span) => span.text), symbol.id).toEqual(symbol.kind === 'function' ? declared : [])
        expect(links.map((span) => span.link!.href), symbol.id).toEqual(links.map((span) => `#${encodeURIComponent(parameterId(symbol, span.text))}`))
        // Each link lands on a parameter row the page lists.
        const rows = new Set(apiEntryFields(symbol, 'c').params.map((param) => param.name))
        expect(links.map((span) => span.text).filter((name) => !rows.has(name)), symbol.id).toEqual([])
        if (layout.text !== signature.raw) wrapped++
      }
    }
    expect(checked).toBeGreaterThan(1000)
    expect(wrapped).toBeGreaterThan(checked / 2)
    expect([...kinds].toSorted()).toEqual(['attribute', 'enum', 'function', 'typealias'])
  })

  it('leaves macros, variables with initializers, structs and plain typedefs as the source has them', async () => {
    const left = model.symbols.filter((symbol) => !supportsCSignatures(symbol, 'c') && symbol.signatures.some((signature) => signature.raw))
    expect(left.length).toBeGreaterThan(0)
    for (const symbol of left.slice(0, 400)) expect(await apiSignatureLayouts(symbol, 'c'), symbol.id).toEqual(new Map())
    const kinds = new Set(left.map((symbol) => symbol.kind))
    for (const kind of ['constant', 'struct', 'attribute', 'typealias']) expect(kinds, kind).toContain(kind)
    expect(find('cmd_list_panes_entry', 'attribute').signatures[0]!.raw).toContain('.name = "list-panes"')
    expect(supportsCSignatures(find('cmd_list_panes_entry', 'attribute'), 'c')).toBe(false)
    expect(supportsCSignatures(find('utf8_char', 'typealias'), 'c')).toBe(false)
    expect(supportsCSignatures(model.symbols.find((entry) => entry.kind === 'enum' && /<</.test(entry.signatures[0]?.raw ?? ''))!, 'c')).toBe(false)
    // Other languages keep their own layouts.
    expect(supportsCSignatures(find('cmd_list_panes_window'), 'cxx')).toBe(false)
  })

  it.each([['window_copy_cmd_scroll_bottom', 'function'], ['mode_tree_draw_cb', 'typealias'], ['cmd_retval', 'enum']])(
    'prints %s in the Markdown export as it lays it out', async (name, kind) => {
      const symbol = find(name, kind)
      const layouts = await apiSignatureLayouts(symbol, 'c')
      expect(layouts.size).toBe(symbol.signatures.length)
      const markdown = await symbolMarkdownWithLayout({ model, symbol, index })
      const code = fromMarkdown(markdown).children.find((node) => node.type === 'code')
      expect(code?.type === 'code' && code.value).toBe(symbol.signatures.map((signature) => layouts.get(signature)!.text).join('\n\n'))
      expect(code?.type === 'code' && code.value.includes('\n')).toBe(true)
    })

  it('keeps the source text in the Markdown export where no layout applies', async () => {
    const symbol = find('cmd_list_panes_entry', 'attribute')
    const markdown = await symbolMarkdownWithLayout({ model, symbol, index })
    const code = fromMarkdown(markdown).children.find((node) => node.type === 'code')
    expect(code?.type === 'code' && code.value).toBe(symbol.signatures[0]!.raw)
  })

  it('follows the shared budget', async () => {
    const symbol = find('cmd_list_panes_window')
    const original = CODE_COLUMNS.api
    try {
      for (const limit of [40, 60, 90]) {
        Object.assign(CODE_COLUMNS, { api: limit })
        const layout = await layoutOf(symbol)
        expect(layout.limit).toBe(limit)
        expect(layout.text).toBe(formatCDeclaration(symbol.signatures[0]!.raw!, limit))
        expect(layout.failures).toEqual(await codeWidthFailures(layout.text, 'api'))
      }
      // Wider, more parameters share the first line; narrower, the list hangs below the parenthesis.
      expect(formatCDeclaration(EXAMPLE.raw, 90)).toBe([
        'static void cmd_list_panes_window(struct cmd *, struct session *, struct winlink *,',
        '                                  struct cmdq_item *, int)',
      ].join('\n'))
      expect(formatCDeclaration(EXAMPLE.raw, 40)).toBe([
        'static void cmd_list_panes_window(',
        '    struct cmd *, struct session *,',
        '    struct winlink *,',
        '    struct cmdq_item *, int)',
      ].join('\n'))
    } finally { Object.assign(CODE_COLUMNS, { api: original }) }
  })
})

/** The formatter the fixtures pin, when this machine has it. */
function clangFormat(): ((text: string, limit: number) => string) | undefined {
  try {
    if (!/clang-format version 21\./.test(execFileSync('clang-format', ['--version'], { encoding: 'utf8' }))) return undefined
  } catch { return undefined }
  const style = (limit: number) => `{BasedOnStyle: LLVM, ColumnLimit: ${limit}, PointerAlignment: Right, AlignAfterOpenBracket: Align, BinPackParameters: true, ContinuationIndentWidth: 4, IndentWidth: 2}`
  return (text, limit) => execFileSync('clang-format', ['--assume-filename=declaration.c', `--style=${style(limit)}`], { input: `${text}\n`, encoding: 'utf8' }).trimEnd()
}
const clang = clangFormat()

describe.skipIf(!clang)('C layouts agree with the clang-format on this machine', () => {
  it('formats a sample of the declarations in both tmux versions as clang-format does', () => {
    const raws = new Map<string, string>()
    for (const version of VERSIONS) {
      for (const symbol of tmuxSourceModel(version).symbols) {
        if (!supportsCSignatures(symbol, 'c') || symbol.kind === 'enum') continue
        for (const signature of symbol.signatures) raws.set(signature.raw!, symbol.id)
      }
    }
    const sample = [...raws.keys()].filter((_, at) => at % 20 === 0)
    expect(sample.length).toBeGreaterThan(100)
    const strip = (text: string) => text.endsWith(';') ? text.slice(0, -1) : text
    const disagreements: unknown[] = []
    for (const raw of sample) {
      const actual = formatCDeclaration(raw, 60)
      if (raw.trimEnd().endsWith(';')) {
        if (actual !== clang!(raw, 60)) disagreements.push({ raw, expected: clang!(raw, 60), actual })
        continue
      }
      // The page never prints the `;` clang-format needs, so it takes no column. Where clang-format
      // with the `;` in the last column keeps every line within 60, the two agree exactly; where it
      // does not, the last line is at the limit or clang-format with the `;` inside 60 agrees.
      const outside = strip(clang!(`${raw};`, 61))
      const inside = strip(clang!(`${raw};`, 60))
      const exact = outside.split('\n').every((line) => line.length <= 60)
      if (exact ? actual !== outside : actual !== inside && actual.split('\n').at(-1)!.length !== 60) disagreements.push({ raw, outside, inside, actual })
    }
    expect(disagreements).toEqual([])
  }, 60_000)

  it('formats enums as clang-format does', () => {
    const raws = new Set<string>()
    for (const version of VERSIONS) {
      for (const symbol of tmuxSourceModel(version).symbols) {
        if (symbol.kind === 'enum' && supportsCSignatures(symbol, 'c')) for (const signature of symbol.signatures) raws.add(signature.raw!)
      }
    }
    expect(raws.size).toBeGreaterThan(50)
    const disagreements: unknown[] = []
    for (const raw of raws) {
      const terminated = raw.trimEnd().endsWith(';')
      const expected = terminated ? clang!(raw, 60) : clang!(`${raw};`, 61).slice(0, -1)
      if (expected.split('\n').some((line) => line.length > 60)) continue
      const actual = formatCEnumDeclaration(raw, 60)
      if (actual !== expected) disagreements.push({ raw, expected, actual })
    }
    expect(disagreements).toEqual([])
  }, 60_000)
})
