# Native observation interface fixture

These are unmodified public Haddock pages and the installed interface for
`libtmux-haskell` at
[`0f99299022ac819968834838c6d18a2faaf17443`](https://github.com/libtmux/libtmux-haskell/commit/0f99299022ac819968834838c6d18a2faaf17443).
An isolated Git archive was built with GHC 9.14.1, GHC2024, Cabal 3.18.2.0
and Haddock 2.33.0. `provenance.json` records input identities and hashes.

The source-anchor index retains native identifiers and line markers, with
duplicates intact. It covers the public modules and the private files that
define reexported public types; it contains no implementation text. Every
consumed source page was compared with its corresponding archived source
bytes after removing generated annotation tooltips.

The fixture tests the observation profile separately from the scalar v1
fixture. Shared field identities include their record owner; native labels,
signatures and destinations remain unchanged. Module reexports remain
ordered references rather than copies of the target declarations.
