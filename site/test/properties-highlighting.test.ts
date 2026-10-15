import { createRenderer } from 'astro-expressive-code'
import { select, toHtml } from 'astro-expressive-code/hast'
import { Window } from 'happy-dom'
import type { ApiModel } from '@libtmux/api-model'
import { createHighlighterCore, createOnigurumaEngine, type HighlighterCore, type ThemedToken } from 'shiki'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import config from '../ec.config.mjs'
import { codeLang, highlightInline } from '../src/lib/highlight'
import { properties } from '../src/lib/properties.mjs'
import { shellThemes } from '../src/plugins/ec-shell-prompt.mjs'
import java from '../src/data/api/java.json'
import kotlin from '../src/data/api/kotlin.json'
import scala from '../src/data/api/scala.json'
import { symbolMarkdown } from '../src/lib/symbol-markdown'

const gradle = 'org.gradle.jvmargs=-Xmx2g -XX:MaxMetaspaceSize=768m -Dfile.encoding=UTF-8\n' +
  'kotlin.daemon.jvmargs=-Xmx2g\norg.gradle.workers.max=2'

describe('properties highlighting', () => {
  let highlighter: HighlighterCore
  beforeAll(async () => {
    highlighter = await createHighlighterCore({ themes: shellThemes(), langs: [properties],
      engine: createOnigurumaEngine(import('shiki/wasm')) })
  })
  afterAll(() => highlighter.dispose())
  const scopes = (token: ThemedToken) => token.explanation?.flatMap((part) => part.scopes.map((scope) => scope.scopeName)) ?? []

  it('retains the properties language through API prose and example normalization', () => {
    expect(codeLang('properties')).toBe('properties')
    expect(codeLang('ini')).toBe('ini')
    expect(codeLang('unknown-properties-format')).toBe('text')
  })

  it('highlights the Gradle file in both themes without changing its text', async () => {
    const html = await highlightInline(gradle, 'properties')
    const window = new Window()
    try {
      window.document.body.innerHTML = `<code>${html}</code>`
      expect(window.document.body.textContent).toBe(gradle)
      const spans = [...window.document.querySelectorAll('span[style]')]
      const key = spans.find((span) => span.textContent?.startsWith('org.gradle.jvmargs'))!
      const value = spans.find((span) => span.textContent?.includes('-XX:MaxMetaspaceSize=768m'))!
      expect(key).toBeDefined()
      expect(value).toBeDefined()
      for (const theme of ['light', 'dark']) {
        const color = (element: typeof key) => element.getAttribute('style')?.match(new RegExp(`--shiki-${theme}:([^;]+)`))?.[1]
        expect(color(key)).toBeDefined()
        expect(color(value)).not.toBe(color(key))
      }
    } finally { await window.happyDOM.abort() }
  })

  it('uses the ordinary Expressive Code frame and exact Copy payload', async () => {
    const renderer = await createRenderer(config)
    const result = await renderer.ec.render({ code: gradle, language: codeLang('properties') })
    expect(select('pre', result.renderedGroupAst)?.properties.dataLanguage).toBe('properties')
    expect(select('[data-code]', result.renderedGroupAst)?.properties.dataCode).toBe(gradle.replaceAll('\n', '\x7f'))
    expect(toHtml(result.renderedGroupAst)).toContain('class="copy"')
    expect(toHtml(result.renderedGroupAst)).toContain('org.gradle.jvmargs')
  })

  it.each([java, kotlin, scala] as unknown as ApiModel[])('preserves the source-bound $port Gradle example and export', async (model) => {
    const symbol = model.symbols.find((entry) => entry.doc?.examples?.some((block) => block.lang === 'properties'))!
    const block = symbol.doc!.examples!.find((entry) => entry.lang === 'properties')!
    expect(block.intro).toContain('gradle.properties')
    expect(block.code.trimEnd()).toBe(gradle)
    expect(block.sourceUrl).toContain(`/blob/${symbol.source.revision}/`)
    expect(symbolMarkdown({ model, symbol })).toContain('```properties\n' + block.code.trimEnd())
    const renderer = await createRenderer(config)
    const result = await renderer.ec.render({ code: block.code, language: codeLang(block.lang) })
    expect(select('pre', result.renderedGroupAst)?.properties.dataLanguage).toBe('properties')
    expect(select('[data-code]', result.renderedGroupAst)?.properties.dataCode).toBe(block.code.trimEnd().replaceAll('\n', '\x7f'))
  })

  it.each(['github-light', 'github-dark'])('preserves native properties semantics in %s', (theme) => {
    const code = [
      '  # comment\\', '! another comment', 'name:two:three=4', 'white value with spaces',
      'escaped\\ key\\:part\\=path=hello\\ world\\u0041', 'empty=', 'key-only', '=empty key',
      ';native.key=value', '[native.key]=value',
      'multi=first\\', '  !not a comment\\', '  #also value',
      'key\\', '  Part=value', 'even=slash\\\\', '# separate comment',
    ].join('\n')
    const lines = highlighter.codeToTokens(code, { lang: properties.name, theme, includeExplanation: true }).tokens
    expect(lines.map((line) => line.map((token) => token.content).join('')).join('\n')).toBe(code)
    const find = (line: number, text: string) => lines[line].find((token) => token.content.includes(text))!
    for (const line of [0, 1, 16]) expect(scopes(find(line, 'comment'))).toContain('comment.line.properties')
    for (const [line, text] of [[2, 'name'], [3, 'white'], [6, 'key-only'], [8, ';native.key'], [9, '[native.key]'], [14, 'Part']] as const) {
      expect(scopes(find(line, text))).toContain('keyword.other.properties')
      expect(scopes(find(line, text))).not.toContain('string.unquoted.properties')
    }
    for (const [line, text] of [[2, 'two:three=4'], [3, 'value with spaces'], [7, 'empty key'], [11, '!not a comment'], [12, '#also value']] as const) {
      expect(scopes(find(line, text))).toContain('string.unquoted.properties')
      expect(scopes(find(line, text))).not.toContain('comment.line.properties')
    }
    for (const escape of ['\\ ', '\\:', '\\=', '\\u0041']) {
      expect(scopes(find(4, escape))).toContain('constant.character.escape.properties')
    }
  })
})
