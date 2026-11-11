---
port: clojure
route: examples
title: Examples
description: Run the thirteen tested Clojure programs against private tmux servers.
sidebar:
  group: Examples
  order: 1
---

The [quickstart](../) creates a session, renames and splits its window, sends a
shell command, and prints the captured graph and output. Its setup installs
the documented source into an isolated Maven repository. Every view closes
its client and stops the server it created.

The repository tests thirteen complete programs. Each one is shown, with its
imports, Tools.deps setup, an owned-server launcher and expected output, on the
API reference page named in its row. The source column links the file at the
documented revision.

## Connect and read

| Program | What it demonstrates | Source |
| --- | --- | --- |
| [Connect](../reference/libtmux-core-open/) | Connect to a private tmux server. | [connect.clj](https://github.com/libtmux/libtmux-java/blob/941f2162062b6d118c68b7d1c23417e0d2cea124/examples/src/main/clojure/libtmux/examples/api/connect.clj) |
| [List sessions](../reference/libtmux-core-sessions/) | List sessions from one capture. | [list_sessions.clj](https://github.com/libtmux/libtmux-java/blob/941f2162062b6d118c68b7d1c23417e0d2cea124/examples/src/main/clojure/libtmux/examples/api/list_sessions.clj) |
| [List windows](../reference/libtmux-data-windows/) | Traverse root and session windows in one captured graph. | [list_windows.clj](https://github.com/libtmux/libtmux-java/blob/941f2162062b6d118c68b7d1c23417e0d2cea124/examples/src/main/clojure/libtmux/examples/api/list_windows.clj) |
| [List panes](../reference/libtmux-data-panes/) | Traverse root, session, window and pane observations. | [list_panes.clj](https://github.com/libtmux/libtmux-java/blob/941f2162062b6d118c68b7d1c23417e0d2cea124/examples/src/main/clojure/libtmux/examples/api/list_panes.clj) |
| [Query](../reference/libtmux-data-matching/) | Evaluate native and Java predicates over the same capture. | [query.clj](https://github.com/libtmux/libtmux-java/blob/941f2162062b6d118c68b7d1c23417e0d2cea124/examples/src/main/clojure/libtmux/examples/api/query.clj) |

## Create and arrange

| Program | What it demonstrates | Source |
| --- | --- | --- |
| [New session](../reference/libtmux-core-new-session/) | Create a session running `cat`. | [new_session.clj](https://github.com/libtmux/libtmux-java/blob/941f2162062b6d118c68b7d1c23417e0d2cea124/examples/src/main/clojure/libtmux/examples/api/new_session.clj) |
| [New window](../reference/libtmux-core-new-window/) | Create a detached window and refresh its parent. | [new_window.clj](https://github.com/libtmux/libtmux-java/blob/941f2162062b6d118c68b7d1c23417e0d2cea124/examples/src/main/clojure/libtmux/examples/api/new_window.clj) |
| [Workspace](../reference/libtmux-core-split-pane/) | Build a split layout, rename a window and follow its moved placement. | [workspace.clj](https://github.com/libtmux/libtmux-java/blob/941f2162062b6d118c68b7d1c23417e0d2cea124/examples/src/main/clojure/libtmux/examples/api/workspace.clj) |

## Send, capture and run

| Program | What it demonstrates | Source |
| --- | --- | --- |
| [Capture](../reference/libtmux-core-capture/) | Send literal shell input and wait for actual output before capture. | [capture.clj](https://github.com/libtmux/libtmux-java/blob/941f2162062b6d118c68b7d1c23417e0d2cea124/examples/src/main/clojure/libtmux/examples/api/capture.clj) |
| [Run a command](../reference/libtmux-core-new-session/) | Use the preserved Java pane ref to read a command exit status and output. | [run_a_command.clj](https://github.com/libtmux/libtmux-java/blob/941f2162062b6d118c68b7d1c23417e0d2cea124/examples/src/main/clojure/libtmux/examples/api/run_a_command.clj) |

## Concurrency and streams

| Program | What it demonstrates | Source |
| --- | --- | --- |
| [Capture concurrently](../reference/libtmux-async-submit/) | Capture with bounded workers and cancel an owned wait after cleanup. | [capture_concurrently.clj](https://github.com/libtmux/libtmux-java/blob/941f2162062b6d118c68b7d1c23417e0d2cea124/examples/src/main/clojure/libtmux/examples/api/capture_concurrently.clj) |
| [Watch pane output](../reference/libtmux-control-subscribe/) | Read bounded UTF-8 output on an owned wait worker and inspect local termination. | [watch_pane_output.clj](https://github.com/libtmux/libtmux-java/blob/941f2162062b6d118c68b7d1c23417e0d2cea124/examples/src/main/clojure/libtmux/examples/api/watch_pane_output.clj) |
| [Observe with core.async](../reference/libtmux-core-async-observe/) | Read bounded core.async events and stop without closing the borrowed connection. | [observe_with_async.clj](https://github.com/libtmux/libtmux-java/blob/941f2162062b6d118c68b7d1c23417e0d2cea124/examples/src/main/clojure/libtmux/examples/api/observe_with_async.clj) |

The stream examples require tmux 3.7 or newer. On an older supported tmux,
they print the capability refusal shown beside the expected output.
