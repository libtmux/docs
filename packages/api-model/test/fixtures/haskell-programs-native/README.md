# Native Program interface fixture

`artifact.json` replays the raw Haddock interface and pages retained by
[the successful source CI run](https://github.com/libtmux/libtmux-haskell/actions/runs/44450833219)
at [the recorded source](https://github.com/libtmux/libtmux-haskell/commit/b6f05b346bd0bfbef7b54bfbd2338babb2a7895d).
The artifact records the immutable downloads, native input hashes and
committed exporter separately. Every required native source page matches
the recorded source bytes.

This profile adds `LibTmux.Program` and `LibTmux.Capabilities`. The umbrella
module imports selected Program exports: callers construct `ProgramOptions`
or use its fields through `LibTmux.Program`. The exporter checks partial
aliases against compiled owners and signatures, records their selected
members, and retains one canonical declaration per public API.

Program operations own their application resources on a borrowed daemon.
Their input and rendered output do not qualify general pane capture, waits
or event streams. Earlier native profiles retain their own fixtures.
