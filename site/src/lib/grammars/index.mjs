import cabal from './cabal.tmLanguage.json' with { type: 'json' }
import dune from './dune.tmLanguage.json' with { type: 'json' }
import gemfileLock from './gemfile-lock.tmLanguage.json' with { type: 'json' }
import gomod from './gomod.tmLanguage.json' with { type: 'json' }
import opam from './opam.tmLanguage.json' with { type: 'json' }

/**
 * Shiki languages the site owns for file formats its pages show and Shiki does
 * not bundle. Each lists the file names it reads as aliases, so a fence can
 * name the file (```` ```go.mod ````) as well as the language.
 *
 * Both highlighters register these: Expressive Code (`ec.config.mjs`) for
 * fences and `<Code>`, and the shared Shiki instance in `highlight.ts` for the
 * installer, source pages and previews.
 *
 * @type {import('shiki').LanguageRegistration[]}
 */
export const fileGrammars = [
  { ...cabal, displayName: 'Cabal', aliases: ['cabal.project', 'cabal-project'] },
  { ...dune, displayName: 'Dune', aliases: ['dune-project', 'dune-workspace'] },
  { ...gemfileLock, displayName: 'Bundler lockfile', aliases: ['gemfile.lock'] },
  { ...gomod, displayName: 'Go module', aliases: ['go.mod', 'go-mod', 'go.work'] },
  { ...opam, displayName: 'opam' },
]
