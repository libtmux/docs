import bundled from 'shiki/langs/haskell.mjs'

const EXTENSION = 'keyword.other.preprocessor.extension.haskell'

/**
 * Shiki's Haskell grammar with a LANGUAGE pragma that colours any extension.
 *
 * The bundled grammar is a 2020 snapshot that lists extension names, so every
 * extension GHC added since (OverloadedRecordDot, NoFieldSelectors, ...) renders
 * as plain text. Deprecated names keep their own earlier rule.
 */
export const haskell = bundled.map((grammar) => {
  const copy = structuredClone(grammar)
  const pragma = copy.repository.pragma.patterns.find((rule) => rule.begin?.includes('(LANGUAGE)'))
  const extensions = pragma?.patterns.find((rule) => rule.captures?.[1]?.name === EXTENSION)
  if (!extensions) throw new Error('Shiki Haskell grammar has no LANGUAGE extension rule to widen')
  extensions.match = String.raw`(?<![\w'])([A-Z]\w*)`
  return copy
})
