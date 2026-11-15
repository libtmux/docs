---
port: haskell
route: examples
title: Examples
description: Run the tested Haskell programs, offline or against a private tmux server, and compare each with its expected output.
sidebar:
  group: Examples
  label: Overview
  order: 1
---

Each program under `examples/` has its own Cabal package and expected output.
Run one from the repository root, for example
`cabal run --verbose=0 typed-values`. The tmux programs take the socket of the
README's private demonstration server and a `tmux` binary. `mutate-graph` and
`create-session` change that server. `typed-values` and `offline-graph` need no
server.

| Program | What it demonstrates | Guide |
| --- | --- | --- |
| [typed-values](https://github.com/libtmux/libtmux-haskell/blob/282b89a86a6ef8bc511f040acdb0e1b557db1226/examples/typed-values/Main.hs) | Parse a window ID and a supported tmux release, construct a checked dimension and print them. Opens no socket and starts no process. | [Typed values](../guides/typed-values/) |
| [offline-graph](https://github.com/libtmux/libtmux-haskell/blob/282b89a86a6ef8bc511f040acdb0e1b557db1226/examples/offline-graph/Main.hs) | Build a validated fixture and select active panes by width. A repeated window link shows physical entities against contextual appearances. Opens no socket. | [Offline fixtures](../guides/offline-fixtures/) |
| [capture-graph](https://github.com/libtmux/libtmux-haskell/blob/282b89a86a6ef8bc511f040acdb0e1b557db1226/examples/capture-graph/Main.hs) | Capture a running server, close its handle, then filter detached panes and follow session-to-window links. | [Capture and navigate](../guides/capture/) |
| [query-graph](https://github.com/libtmux/libtmux-haskell/blob/282b89a86a6ef8bc511f040acdb0e1b557db1226/examples/query-graph/Main.hs) | Compare a typed query with an ordinary pane predicate, traverse relationships and check cardinality. | [Typed queries](../guides/query/) |
| [shared-runtime](https://github.com/libtmux/libtmux-haskell/blob/282b89a86a6ef8bc511f040acdb0e1b557db1226/examples/shared-runtime/Main.hs) | Open independent Server scopes under one Runtime, close one handle and capture through the other. | [Shared Runtime scopes](../guides/shared-runtime/) |
| [mutate-graph](https://github.com/libtmux/libtmux-haskell/blob/282b89a86a6ef8bc511f040acdb0e1b557db1226/examples/mutate-graph/Main.hs) | Rename a session and a window and set a pane title through captured references, then capture again. The earlier snapshot keeps its old values. | [Rename and set pane titles](../guides/mutations/) |
| [create-session](https://github.com/libtmux/libtmux-haskell/blob/282b89a86a6ef8bc511f040acdb0e1b557db1226/examples/create-session/Main.hs) | Create a detached session, rename its initial window, set its pane title and compare captured references. A repeated name is rejected. | [Create a session](../guides/creation/) |
