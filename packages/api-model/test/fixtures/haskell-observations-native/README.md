# Native observation interface fixture

These public Haddock pages and the installed interface describe
`libtmux-haskell` at
[`b9960257139c630985fced6d14ac59ba6870df02`](https://github.com/libtmux/libtmux-haskell/commit/b9960257139c630985fced6d14ac59ba6870df02).
An isolated Git archive was built with GHC 9.14.1, GHC2024, Cabal 3.18.2.0
and Haddock 2.33.0. `provenance.json` records input identities and hashes.
The HTML files retain the native bytes. `installed.json` stores the native
JSON interface with indentation while preserving every parsed value.

The source-anchor index retains native identifiers and line markers, with
duplicates intact. It covers the public modules and the private files that
define reexported public types; it contains no implementation text. Every
consumed source page was compared with its corresponding archived source
bytes after removing generated annotation tooltips.

The fixture tests the observation profile separately from the scalar v1
fixture. Shared field identities include their record owner; native labels,
signatures and destinations remain unchanged. Module reexports remain
ordered references rather than copies of the target declarations.

`artifact.json` is the source-bound `libtmux.haskell-api/2` export with the
`observations/1` profile. Its provenance records the committed producer
separately from the library, plus every consumed source and native input.
The scalar v1 artifact remains in the sibling `haskell-native` fixture.
