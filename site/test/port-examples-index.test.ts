import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import clojureModel from '../src/data/api/clojure.json'
import haskellModel from '../src/data/api/haskell.json'
import erlangModel from '../src/data/api/erlang.json'
import lispModel from '../src/data/api/lisp.json'
import ocamlModel from '../src/data/api/ocaml.json'

const page = (path: string) => readFileSync(new URL(`../src/content/docs/ports/${path}`, import.meta.url), 'utf8')

// Each index lists every program its port's tests run and links the source at
// the revision of the API model, so a moved pin fails here until the links follow.
const INDEXES = [
  { path: 'erlang/examples/index.md', repo: 'libtmux-erlang', revision: erlangModel.revision, programs: 16 },
  { path: 'lisp/examples/index.md', repo: 'libtmux-lisp', revision: lispModel.revision, programs: 6 + 4 },
  { path: 'clojure/examples.md', repo: 'libtmux-java', revision: clojureModel.revision, programs: 13 },
  { path: 'haskell/examples/index.md', repo: 'libtmux-haskell', revision: haskellModel.revision, programs: 6 },
  { path: 'ocaml/examples/index.md', repo: 'libtmux-ocaml', revision: ocamlModel.revision, programs: 20 },
]

it.each(INDEXES)('lists $programs source files of $repo at the model revision', ({ path, repo, revision, programs }) => {
  const links = [...page(path).matchAll(new RegExp(`https://github\\.com/libtmux/${repo}/blob/([0-9a-f]{40})/\\S+?\\)`, 'g'))]
  expect(links).toHaveLength(programs)
  for (const [, sha] of links) expect(sha).toBe(revision)
})
