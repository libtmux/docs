import grammar from '../vendor/haskell-grammar/haskell.tmLanguage.json' with { type: 'json' }

/**
 * Shiki's `haskell` language, from the vendored upstream grammar rather than
 * the 2020 one Shiki bundles; see ../vendor/haskell-grammar/README.md.
 *
 * @type {import('shiki').LanguageRegistration[]}
 */
export const haskell = [{ ...grammar, name: 'haskell', displayName: 'Haskell', aliases: ['hs'] }]
