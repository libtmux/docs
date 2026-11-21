# Native environment interface fixture

`artifact.json` replays the unprepared Haddock output from
[the successful source CI run](https://github.com/libtmux/libtmux-haskell/actions/runs/44457420410)
at [the recorded source](https://github.com/libtmux/libtmux-haskell/commit/ac127a605d6861d912d89efb9199d470bbfbb987).
The immutable checks and prepared-docs archives contain byte-identical compiled
interfaces. Every required source page matches the selected committed bytes.

The profile includes pane text waits, explicit window-link operations and named
environment entries. `NamedLayout` is public through `LibTmux.Server` and is
defined in `LibTmux.Internal.Command`; its private origin remains source
provenance. The public module inventory adds `LibTmux.Environment`.
