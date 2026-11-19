# Native lifecycle export fixture

`artifact.json` retains the exporter's output for the unshipped
[lifecycle source](https://github.com/libtmux/libtmux-haskell/commit/03c914a6298708c786cea21233eb39acf9b7c085),
built with GHC 9.14.1, Haddock 2.33 and Cabal 3.18.2.0 by the committed
[producer](https://github.com/libtmux/docs/commit/7f5c4e2501d768ffa42730dd645df723378ebf62).
The artifact keeps the creation profile: `withOwnedServer`, `killServer`,
`OwnedServerConfig` and `defaultOwnedServerConfig` are declared in
`LibTmux.Server`, so no new defining origin is needed.

The adapter replays this historical export to retain coverage of its native
declaration shapes. The site's rendering suites compare the shipped creation
profile with the [creation fixture](../haskell-creations-native/README.md).
