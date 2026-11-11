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
API reference yet. The core library captures complete server state, queries
detached snapshots with typed predicates, and renames sessions and windows or
sets pane titles through checked references. It also provides typed IDs,
checked dimensions and indices, and tmux-version admission. It cannot yet
create sessions, windows or panes, send input, or stream events, which a
workspace manager needs.

Start with the [core library](../core/) and its
[examples](../examples/). Read the
[implementation status](../guides/status/) for the available capabilities and
remaining work.
