---
title: Haskell workspace manager is not published
description: The Haskell workspace library and command-line tool are planned. No workspace package or loader command is available.
port: haskell
product: workspace
sidebar:
  label: Availability
  order: 0
tableOfContents: true
---

Haskell has no published libtmux workspace manager. The planned library and
command-line tool will live in a separate Cabal package and use the core
library to operate on tmux.

There is no workspace package to install, loader command to run, or workspace
API reference yet. The current public core provides typed IDs, checked
dimensions and indices, and tmux-version admission.

Start with the [core library](../core/) and its
[tested values example](../guides/typed-values/). Read the
[implementation status](../guides/status/) for the available capabilities and
remaining work.
