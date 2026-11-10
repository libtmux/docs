# Native mutation interface fixture

The original Haddock pages and installed interface describe
[`libtmux-haskell` at the recorded revision](https://github.com/libtmux/libtmux-haskell/commit/0283cdccbee96593544c61c6db467785a0e06572).
Every consumed source page was checked against the committed bytes.
`provenance.json` records the public modules, defining origins and input hashes.

This profile adds checked rename and pane-title operations, their options and
opaque recovery receipts. `MutationRecovery` is publicly owned by `LibTmux.Server`
and defined in `LibTmux.Internal.Mutation`; no private module becomes a public
reference page. Earlier scalar, observation and query fixtures remain separate.
