import { createRenderer } from 'astro-expressive-code'
import { toHtml } from 'astro-expressive-code/hast'
import { describe, expect, it } from 'vitest'
import config from '../ec.config.mjs'
import { highlightInline } from '../src/lib/highlight'

/**
 * Extensions newer than the Haskell grammar Shiki bundles, which lists names
 * instead of matching them, plus one no GHC has shipped.
 */
const MISSING = ['OverloadedRecordDot', 'OverloadedRecordUpdate', 'FieldSelectors', 'NoFieldSelectors', 'LinearTypes', 'TypeData', 'NoFutureGhcExtension']
const code = ['OverloadedStrings', 'DoRec', ...MISSING].map((name) => `{-# LANGUAGE ${name} #-}`).join('\n')

/** The theme variables of the token that holds `name`, light and dark together. */
function style(html: string, name: string) {
  const span = [...html.matchAll(/<span style="([^"]*)">([^<]*)<\/span>/g)].find((match) => match[2].includes(name))
  expect(span, `${name} sits in a styled span`).toBeDefined()
  return span![1].toLowerCase()
}

describe('Haskell LANGUAGE pragmas', () => {
  const renders = {
    'Expressive Code': async () => toHtml((await (await createRenderer(config)).ec.render({ code, language: 'haskell' })).renderedGroupAst),
    'inline widgets': () => highlightInline(code, 'haskell'),
  }

  it.each(Object.entries(renders))('colours every extension like OverloadedStrings in %s', async (_path, render) => {
    const html = await render()
    const keyword = style(html, 'OverloadedStrings')
    for (const name of MISSING) expect(style(html, name), name).toBe(keyword)
    expect(style(html, 'DoRec'), 'deprecated extensions keep their own style').not.toBe(keyword)
  })
})
