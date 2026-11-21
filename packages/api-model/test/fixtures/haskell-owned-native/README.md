# Native private daemon interface fixture

The committed exporter built this fixture from a clean archive with GHC
9.14.1, Haddock 2.33.0 and Cabal 3.18.2.0. The artifact records 34 committed
source and build inputs and hashes the compiled interface and native pages.
[Haskell source 6491b89](https://github.com/libtmux/libtmux-haskell/commit/6491b89cf2b0287437d3fa7d92e95623fda1303e)

The fixture covers 17 public modules and 857 declarations, including private
daemon ownership, pane relocation and state waits. Reference tests compare
the rendered declaration kind, signature text and linked spans with the
native export.
