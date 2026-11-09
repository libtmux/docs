---
title: Erlang workspace manager is not published
description: The unreleased OTP application loads and validates JSON desired state. Planning, applying changes and a command-line tool are unfinished.
port: erlang
product: workspace
sidebar:
  label: Availability
  order: 0
tableOfContents: true
---

The Erlang workspace manager is an unreleased OTP application. Its source
loader validates JSON describing desired sessions, windows and panes.
Planning, applying changes and a standalone command-line tool are unfinished.

[`tmux_workspace:load/1`](https://github.com/libtmux/libtmux-erlang/blob/6fc546e1407b3257bce4699a564e2fbe32ea70a2/apps/libtmux_erlang_workspace/src/tmux_workspace.erl#L71)
reads a local file and resolves working directories.
[`tmux_workspace:to_map/1`](https://github.com/libtmux/libtmux-erlang/blob/6fc546e1407b3257bce4699a564e2fbe32ea70a2/apps/libtmux_erlang_workspace/src/tmux_workspace.erl#L92)
returns the validated document for inspection. Loading a workspace does not
contact tmux or launch programs. The
[workspace source guide](https://github.com/libtmux/libtmux-erlang/blob/6fc546e1407b3257bce4699a564e2fbe32ea70a2/docs/workspaces.md)
includes an input document and a tested loader program.

A registry release and generated workspace API reference are pending.
Start with the [core library](../core/). The [guides](../guides/) cover
installation and the first connection.
