---
title: "Rust workspace topics"
description: "Understand build plans, existing-session checks, YAML support, and freezing."
port: rs
product: workspace
sidebar:
  label: Topics
  order: 1
tableOfContents: true
---

A Rust workspace describes a new session. Parsing reads the description;
planning builds an inert sequence of operations; building executes it on a
server.

## Configuration

`Workspace::from_yaml` accepts tmuxp-style session, window, and pane data. The
configuration supports working directories, commands, environment variables,
options, focus, and layouts. Unknown keys are listed in `unsupported_keys` and
ignored.
That behavior differs from a strict parser: successful parsing does not prove
that every field in a larger tmuxp file was applied.

A pane's working directory overrides its window's directory, which overrides
the workspace's directory. The parser and builder own the supported shape;
Python plugins are not loaded by the crate.

## Preview and execution

`WorkspaceBuilder::plan` does not contact tmux. Its `preview` exposes the
commands and references to objects that later operations will create. This is
a construction plan, not a reconciliation of an existing session.

`build` checks the requested session name and returns
`BuildError::SessionExists`
when it is already present. A later tmux error can leave objects already
created. The builder does not roll back the session, so inspect the dedicated
server and decide whether to keep or remove that partial result.

## Freeze a running session

`freeze` captures windows, panes, working directories, and focus into a
`Workspace`. `to_yaml` serializes that description, and `from_yaml` reads it
back. This recovers structure rather than a process checkpoint: tmux cannot
recover the original command line from the current foreground program alone.

Review exported commands before using the file as a launcher. Freezing does
not preserve application memory, terminal history, or files on disk.

[Builder implementation](https://github.com/libtmux/libtmux-rs/blob/9331cdf556ea7a1f2589e9c3e6cece6ccdc7765c/crates/tmux-workspace/src/lib.rs); [Freeze implementation](https://github.com/libtmux/libtmux-rs/blob/9331cdf556ea7a1f2589e9c3e6cece6ccdc7765c/crates/tmux-workspace/src/freeze.rs).
