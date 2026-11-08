---
port: haskell
route: core
title: "Typed tmux values for Haskell"
description: "Parse tmux entity IDs, validate dimensions and indices, and check stable tmux releases with pure Haskell functions."
cards:
  - label: API reference
    href: ../reference/
    body: Public modules, types, constructors and functions from Haddock.
---

The current package provides typed IDs, checked dimensions and indices, and
stable-release parsing. These operations are pure and need no running tmux
server. The [API reference](../reference/) documents the exports of
`LibTmux.Id`, `LibTmux.Value` and `LibTmux.Version`.

Install the core package from its public Git source with GHC 9.14.1 and Cabal
3.18.2.0 on Linux x86_64. It is not published on Hackage. The repository's
[installation guide](https://github.com/libtmux/libtmux-haskell/blob/master/docs/installation.md)
includes a complete Cabal application and the
[typed-value example](https://github.com/libtmux/libtmux-haskell/tree/master/examples/typed-values).

Client, capture and mutation APIs are under development. The workspace
library and CLI are planned as a separate package using the core. MCP is
excluded from this port. Read the
[implementation status](https://github.com/libtmux/libtmux-haskell/blob/master/docs/status.md)
before choosing the package for automation.
