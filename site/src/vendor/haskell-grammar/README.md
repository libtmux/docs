# Vendored Haskell grammar

The TextMate grammar behind Haskell highlighting on the site, copied from
the maintained Haskell syntax-highlighting extension. Shiki's bundled
Haskell grammar comes from a 2020 fork and lacks every LANGUAGE extension
GHC added since, so `OverloadedRecordDot` rendered as plain text.

| | |
| --- | --- |
| Source | https://github.com/haskell/vscode-haskell-syntax-highlighting |
| Commit | `36c48222a4b6d09ff7b7747fbf7f06f14a1d3046` (2026-11-07) |
| File | `syntaxes/haskell.YAML-tmLanguage` |
| Retrieved | 2026-11-13T02:57:12Z |
| License | BSD-3-Clause, Copyright (c) 2017 Justus Adam; `LICENSE.txt` is the upstream text at that commit |

`haskell.YAML-tmLanguage` is byte-identical to the upstream file.
`haskell.tmLanguage.json` is the same document converted for Shiki, which
`site/src/lib/haskell.mjs` registers as `haskell`. `provenance.json` records
the digests and the upstream git object id that `haskell-grammar-provenance.test.ts`
checks.

## Updating

Download the grammar and LICENSE from the new commit, then update the
commit, URLs, dates, digests and `gitBlobSha1` (`git hash-object`) in
`provenance.json` and in the table above. The workspace has no YAML parser,
so install one outside it:

```console
$ npm install --prefix /tmp/yaml-parser yaml@2.9.1
```

Regenerate the JSON; `--check` verifies the committed JSON instead of
rewriting it:

```console
$ YAML_MODULE=/tmp/yaml-parser/node_modules/yaml/dist/index.js node site/scripts/vendor-haskell-grammar.mjs
```
