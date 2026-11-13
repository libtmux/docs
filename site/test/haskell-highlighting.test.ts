import { createRenderer } from 'astro-expressive-code'
import { toHtml } from 'astro-expressive-code/hast'
import { describe, expect, it } from 'vitest'
import config from '../ec.config.mjs'
import { highlightInline } from '../src/lib/highlight'

/** Extensions newer than the Haskell grammar Shiki bundles, which lacks them. */
const MISSING = ['OverloadedRecordDot', 'OverloadedRecordUpdate', 'FieldSelectors', 'NoFieldSelectors', 'LinearTypes', 'TypeData']
const pragmas = (...names: string[]) => names.map((name) => `{-# LANGUAGE ${name} #-}`).join('\n')

/** The theme variables of the token that holds `name`, light and dark together. */
function style(html: string, name: string) {
  const span = [...html.matchAll(/<span style="([^"]*)">([^<]*)<\/span>/g)].find((match) => match[2].includes(name))
  expect(span, `${name} sits in a styled span`).toBeDefined()
  return span![1].toLowerCase()
}

describe('Haskell LANGUAGE pragmas', () => {
  const renders = {
    'Expressive Code': async (code: string) => toHtml((await (await createRenderer(config)).ec.render({ code, language: 'haskell' })).renderedGroupAst),
    'inline widgets': (code: string) => highlightInline(code, 'haskell'),
  }

  it.each(Object.entries(renders))('colours every extension like OverloadedStrings in %s', async (_path, render) => {
    const html = await render(pragmas('OverloadedStrings', 'DoRec', ...MISSING))
    const keyword = style(html, 'OverloadedStrings')
    for (const name of MISSING) expect(style(html, name), name).toBe(keyword)
    expect(style(html, 'DoRec'), 'deprecated extensions keep their own style').not.toBe(keyword)
  })

  it.each(Object.entries(renders))('colours NoFieldSelectors beside other extensions in one pragma in %s', async (_path, render) => {
    const html = await render('{-# LANGUAGE OverloadedStrings, DuplicateRecordFields, NoFieldSelectors #-}')
    const keyword = style(html, 'OverloadedStrings')
    expect(style(html, 'DuplicateRecordFields')).toBe(keyword)
    expect(style(html, 'NoFieldSelectors')).toBe(keyword)
  })
})
