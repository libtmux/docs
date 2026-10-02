import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHighlighterCore, createOnigurumaEngine, type HighlighterCore, type ThemedToken } from 'shiki'
import { createRenderer } from 'astro-expressive-code'
import { select, toHtml } from 'astro-expressive-code/hast'
import config from '../ec.config.mjs'
import catalog32 from '../src/data/tmux/3.2a.json'
import catalog37 from '../src/data/tmux/3.7c.json'
import { codeLang, highlightInline } from '../src/lib/highlight'
import { tmuxUsage } from '../src/lib/tmux-usage.mjs'
import { shellThemes } from '../src/plugins/ec-shell-prompt.mjs'

function contrast(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const value = hex.slice(1)
    const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value
    const rgb = [0, 2, 4].map((offset) => {
      const channel = parseInt(full.slice(offset, offset + 2), 16) / 255
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
  }
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

const scopeOf = (token?: ThemedToken) => token?.explanation?.flatMap((part) =>
  part.scopes.map((scope) => scope.scopeName)) ?? []

describe('tmux usage highlighting', () => {
  let highlighter: HighlighterCore
  beforeAll(async () => {
    highlighter = await createHighlighterCore({
      themes: shellThemes(), langs: [tmuxUsage],
      engine: createOnigurumaEngine(import('shiki/wasm')),
    })
  })
  afterAll(() => highlighter.dispose())

  const tokens = (code: string, theme = 'github-light') => highlighter.codeToTokens(code, {
    lang: 'tmux-usage', theme, includeExplanation: true,
  })

  it.each([catalog32, catalog37])('distinguishes capture syntax from Bash in tmux $version', (catalog) => {
    const command = catalog.commands.find((entry) => entry.name === 'capture-pane')!
    const highlighted = tokens(`tmux ${command.name} ${command.usage}`).tokens.flat()
    for (const [text, scope] of [
      ['tmux', 'entity.name.command'],
      ['capture-pane', 'entity.name.function'],
      [command.usage.match(/-\w+/)![0], 'constant.other.option'],
      ['-t', 'constant.other.option'],
      ['target-pane', 'variable.parameter'],
      ['[', 'punctuation.definition'],
      [']', 'punctuation.definition'],
    ]) {
      const token = highlighted.find((part) => part.content === text)
      expect(token, `missing token ${text}`).toBeDefined()
      expect(scopeOf(token!)).toContain(`${scope}.tmux-usage`)
    }
  })

  it('keeps nested optional groups and variadic arguments intact', () => {
    const text = 'tmux new-session [-s session-name] [shell-command [argument ...]]'
    const result = tokens(text).tokens.flat()
    expect(result.map((token) => token.content).join('')).toBe(text)
    for (const word of ['session-name', 'shell-command', 'argument']) {
      expect(scopeOf(result.find((token) => token.content === word)!)).toContain('variable.parameter.tmux-usage')
    }
    expect(scopeOf(result.find((token) => token.content.includes('...'))!)).toContain('punctuation.definition.tmux-usage')
  })

  it('preserves every recorded command synopsis byte for byte', () => {
    for (const catalog of [catalog32, catalog37]) {
      for (const command of catalog.commands) {
        const text = `tmux ${command.name} ${command.usage}`
        expect(tokens(text).tokens.map((line) => line.map((token) => token.content).join('')).join('\n')).toBe(text)
      }
    }
  })

  it.each(['github-light', 'github-dark'])('keeps all five roles distinct and readable in %s', (theme) => {
    const result = tokens('tmux capture-pane [-t target-pane]', theme)
    const colors = new Set<string>()
    for (const token of result.tokens.flat().filter((part) => part.content.trim())) {
      colors.add(token.color!)
      expect(contrast(token.color!, result.bg!), `${token.content} on ${result.bg}`).toBeGreaterThanOrEqual(4.5)
    }
    expect(colors.size).toBe(5)
  })

  it('registers the same grammar for inline helpers and Expressive Code without changing copy text', async () => {
    const code = 'tmux capture-pane [-p] [-t target-pane]'
    expect(codeLang('tmux-usage')).toBe('tmux-usage')
    const inline = await highlightInline(code, 'tmux-usage')
    expect(inline).toContain('font-style:italic')
    expect(inline).toContain('--shiki-light:')
    expect(inline).toContain('--shiki-dark:')
    expect(inline.replace(/<[^>]+>/g, '')).toBe(code)

    const renderer = await createRenderer(config)
    const result = await renderer.ec.render({ code, language: 'tmux-usage' })
    expect(select('[data-code]', result.renderedGroupAst)?.properties.dataCode).toBe(code)
    const html = toHtml(result.renderedGroupAst)
    expect(html).toContain('target-pane')
    expect(html).toContain('--0:#E5C07B')
    expect(html).toContain('--1:#8A5400')
  })
})
