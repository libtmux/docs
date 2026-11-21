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
`cabal run --verbose=0 typed-values`. Live programs start and retire their own
private daemon with `withOwnedServer`. `typed-values` and `offline-graph`
need no server. The [installation guide](../guides/installation/) explains
the native host requirements.

`managed-program` owns application resources inside its daemon scope and
requires tmux 3.8, Linux 6.9 process-group pidfds and compatible Bash.

| Program | What it demonstrates | Guide |
| --- | --- | --- |
| [typed-values](https://github.com/libtmux/libtmux-haskell/blob/bf2d94753a8309b75d6f9853e5719572d57d209d/examples/typed-values/Main.hs) | Parse a window ID and a supported tmux release, construct a checked dimension and print them. Opens no socket and starts no process. | [Typed values](../guides/typed-values/) |
| [offline-graph](https://github.com/libtmux/libtmux-haskell/blob/bf2d94753a8309b75d6f9853e5719572d57d209d/examples/offline-graph/Main.hs) | Build a validated fixture and select active panes by width. A repeated window link shows physical entities against contextual appearances. Opens no socket. | [Offline fixtures](../guides/offline-fixtures/) |
| [capture-graph](https://github.com/libtmux/libtmux-haskell/blob/bf2d94753a8309b75d6f9853e5719572d57d209d/examples/capture-graph/Main.hs) | Start a private daemon, capture it and retire the scope, then read detached pane and window values. | [Capture and navigate](../guides/capture/) |
| [query-graph](https://github.com/libtmux/libtmux-haskell/blob/bf2d94753a8309b75d6f9853e5719572d57d209d/examples/query-graph/Main.hs) | Compare a typed query with an ordinary pane predicate, traverse relationships and check cardinality. | [Typed queries](../guides/query/) |
| [shared-runtime](https://github.com/libtmux/libtmux-haskell/blob/bf2d94753a8309b75d6f9853e5719572d57d209d/examples/shared-runtime/Main.hs) | Open independent Server scopes under one Runtime, close one handle and capture through the other. | [Shared Runtime scopes](../guides/shared-runtime/) |
| [mutate-graph](https://github.com/libtmux/libtmux-haskell/blob/bf2d94753a8309b75d6f9853e5719572d57d209d/examples/mutate-graph/Main.hs) | Rename a session and a window and set a pane title through captured references, then capture again. The earlier snapshot keeps its old values. | [Change targets and observe pane text](../guides/mutations/) |
| [create-session](https://github.com/libtmux/libtmux-haskell/blob/bf2d94753a8309b75d6f9853e5719572d57d209d/examples/create-session/Main.hs) | Create and link windows, split an exact pane, send input, wait for fresh text, distinguish environment entries and remove created targets. | [Create sessions, windows and panes](../guides/creation/) |
| [managed-program](https://github.com/libtmux/libtmux-haskell/blob/bf2d94753a8309b75d6f9853e5719572d57d209d/examples/managed-program/Main.hs) | Run literal argv, cancel and retry observation, send input and enforce an owning deadline while preserving borrowed resources. | [Run terminal applications](../guides/programs/) |
| [configure-session](https://github.com/libtmux/libtmux-haskell/blob/bf2d94753a8309b75d6f9853e5719572d57d209d/examples/configure-session/Main.hs) | Read and change scoped options and hooks while preserving the captured target identities. | [Read and change options and hooks](../guides/options/) |
| [watch-window](https://github.com/libtmux/libtmux-haskell/blob/bf2d94753a8309b75d6f9853e5719572d57d209d/examples/watch-window/Main.hs) | Observe a real window rename through a bounded control event stream. | [Observe control notifications](../guides/control/) |
