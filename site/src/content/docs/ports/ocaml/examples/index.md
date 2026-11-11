---
title: OCaml examples
description: Run complete native OCaml programs against an isolated tmux server.
port: ocaml
route: examples
cards:
  - label: Capability showcases
    href: ../guides/showcases/
    body: Run installed programs with explicit setup, output checks and cleanup.
  - label: Partial-failure recovery
    href: ../guides/recovery/
    body: Inspect retained outcomes before deciding which action to take next.
  - label: Workspaces
    href: ../workspace/source-guide/
    body: Validate, plan and apply a complete JSON workspace.
  - label: Interrupted workspace
    href: ../workspace/recovery/
    body: Cancel an Eio waiter, inspect its journal and check the created session.
---

Start with the [graph program](../guides/getting-started/), then run the
[capability showcases](../guides/showcases/). The repository ships 20 programs
under `examples/`. Each is a complete program that uses public packages and
documents its inputs and ownership of tmux resources; CI runs the showcase
programs on the oldest and newest supported tmux. Run one from a source
checkout, for example
`opam exec -- dune exec examples/showcase_bootstrap.exe -- tmux`.

## Connect and capture

| Program | What it demonstrates | Guide |
| --- | --- | --- |
| [native_capture.ml](https://github.com/libtmux/libtmux-ocaml/blob/205dfda49742592b479247049d186956e4a4cfe9/examples/native_capture.ml) | Connect with Eio, capture the server and close the client. | [Getting started](../guides/getting-started/) |
| [native_graph.ml](https://github.com/libtmux/libtmux-ocaml/blob/205dfda49742592b479247049d186956e4a4cfe9/examples/native_graph.ml) | Capture a private server, close the client, then traverse sessions, shared windows and panes. | [Object graph](../guides/graph/) |
| [showcase_bootstrap.ml](https://github.com/libtmux/libtmux-ocaml/blob/205dfda49742592b479247049d186956e4a4cfe9/examples/showcase_bootstrap.ml) | Start a private server and capture its first session. | [Native bootstrap](../guides/bootstrap/) |
| [showcase_graph.ml](https://github.com/libtmux/libtmux-ocaml/blob/205dfda49742592b479247049d186956e4a4cfe9/examples/showcase_graph.ml) | Navigate sessions, shared windows and panes after the client and daemon close. | [Capability showcases](../guides/showcases/) |

## Query a snapshot

| Program | What it demonstrates | Guide |
| --- | --- | --- |
| [native_query.ml](https://github.com/libtmux/libtmux-ocaml/blob/205dfda49742592b479247049d186956e4a4cfe9/examples/native_query.ml) | Filter a snapshot with ordinary functions, then with typed expressions. | [Queries](../guides/queries/) |
| [query_description.ml](https://github.com/libtmux/libtmux-ocaml/blob/205dfda49742592b479247049d186956e4a4cfe9/examples/query_description.ml) | Describe a typed query and report an ambiguous match without touching tmux. | [Queries](../guides/queries/) |
| [query_json.ml](https://github.com/libtmux/libtmux-ocaml/blob/205dfda49742592b479247049d186956e4a4cfe9/examples/query_json.ml) | Decode and encode a scalar query as JSON. | [Wire subset](../guides/query-interchange/) |

## Change tmux

| Program | What it demonstrates | Guide |
| --- | --- | --- |
| [native_build.ml](https://github.com/libtmux/libtmux-ocaml/blob/205dfda49742592b479247049d186956e4a4cfe9/examples/native_build.ml) | Create an `editor` window with two panes and a `logs` window, set a working directory, environment value, option and pane title. | [Control and recovery](../guides/control/) |
| [showcase_create_window.ml](https://github.com/libtmux/libtmux-ocaml/blob/205dfda49742592b479247049d186956e4a4cfe9/examples/showcase_create_window.ml) | Create a window and recapture its name. | [Capability showcases](../guides/showcases/) |
| [showcase_rename_window.ml](https://github.com/libtmux/libtmux-ocaml/blob/205dfda49742592b479247049d186956e4a4cfe9/examples/showcase_rename_window.ml) | Rename a window and keep the earlier observation. | [Capability showcases](../guides/showcases/) |
| [showcase_move_window.ml](https://github.com/libtmux/libtmux-ocaml/blob/205dfda49742592b479247049d186956e4a4cfe9/examples/showcase_move_window.ml) | Move a window to an index in another session. | [Capability showcases](../guides/showcases/) |
| [showcase_layout.ml](https://github.com/libtmux/libtmux-ocaml/blob/205dfda49742592b479247049d186956e4a4cfe9/examples/showcase_layout.ml) | Split a window and apply an even horizontal layout. | [Capability showcases](../guides/showcases/) |
| [showcase_send_keys.ml](https://github.com/libtmux/libtmux-ocaml/blob/205dfda49742592b479247049d186956e4a4cfe9/examples/showcase_send_keys.ml) | Send literal input containing shell and tmux format characters. | [Capability showcases](../guides/showcases/) |

## Observe output

| Program | What it demonstrates | Guide |
| --- | --- | --- |
| [native_watch.ml](https://github.com/libtmux/libtmux-ocaml/blob/205dfda49742592b479247049d186956e4a4cfe9/examples/native_watch.ml) | Subscribe, send literal text, await future bytes and check the rendered screen under an Eio switch. | [Streaming](../guides/streaming/) |
| [native_wait.ml](https://github.com/libtmux/libtmux-ocaml/blob/205dfda49742592b479247049d186956e4a4cfe9/examples/native_wait.ml) | Wait for text already on one pane's screen. | [Streaming](../guides/streaming/) |
| [native_stream_recovery.ml](https://github.com/libtmux/libtmux-ocaml/blob/205dfda49742592b479247049d186956e4a4cfe9/examples/native_stream_recovery.ml) | Recapture and resubscribe after a stream gap. | [Streaming](../guides/streaming/) |
| [showcase_watch.ml](https://github.com/libtmux/libtmux-ocaml/blob/205dfda49742592b479247049d186956e4a4cfe9/examples/showcase_watch.ml) | Observe future output with an application-owned Eio switch. | [Capability showcases](../guides/showcases/) |

## Recover from partial failure

| Program | What it demonstrates | Guide |
| --- | --- | --- |
| [native_recovery.ml](https://github.com/libtmux/libtmux-ocaml/blob/205dfda49742592b479247049d186956e4a4cfe9/examples/native_recovery.ml) | Cancel a waiter and inspect the retained operation outcome. | [Recovery](../guides/recovery/) |
| [native_hook_recovery.ml](https://github.com/libtmux/libtmux-ocaml/blob/205dfda49742592b479247049d186956e4a4cfe9/examples/native_hook_recovery.ml) | Retain a creation whose `after-new-window` hook fails and print the reported IDs. | Source only |
| [native_workspace_recovery.ml](https://github.com/libtmux/libtmux-ocaml/blob/205dfda49742592b479247049d186956e4a4cfe9/examples/native_workspace_recovery.ml) | Interrupt a native workspace apply and inspect its retained journal. | [Interrupted workspace](../workspace/recovery/) |
