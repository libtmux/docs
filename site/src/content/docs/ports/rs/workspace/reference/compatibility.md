---
title: Runtime and configuration support
description: Runtime requirements and configuration boundaries for the Rust workspace command.
port: rs
product: workspace
sidebar:
  label: Runtime and configuration support
  group: "Reference"
  order: 30
tableOfContents: true
---

`tmux-workspace` is the Rust command for loading and capturing tmux
workspaces. The [installation guide](../../guides/installation/) builds the
documented source revision and runs a session on a private socket. The
walkthroughs require tmux 3.2a or newer.

## Runtime and execution

Build with the toolchain selected by the repository's `rust-toolchain.toml`.
The executable provides native loading, capture, discovery, search, conversion,
import and editing. `--generate` exports its command metadata, manual and
completion scripts.

Plugins, custom builders and `shell` use an optional tmuxp 1.74 runtime selected
by `TMUX_WORKSPACE_PYTHON`. Scripted and extension loads require supported
child-process observation; targets without it refuse those operations before
changing tmux.

The workspace crate also exposes a library. Its unsupported-field handling and
modeled builder features differ from the CLI; use the library reference for
application code.

## Configuration and failure handling

Read [configuration](../../configuration/) for the CLI's fields. Unsupported
execution fields fail visibly; generic [conversion](../../cli/convert/)
preserves document values without proving that they can be executed.

Use [machine output](../output/) for automation and check both the process
status and any retained effects. Capture reads live tmux state; it cannot
recover original command arguments, scripts, comments or application state.

[Examples](../../examples/gallery/) provide complete starter documents. Their
pane commands can need additional applications and directories when adapted.
Use [library internals](../../internals/) for the programmatic builder.

[CLI source](https://github.com/libtmux/libtmux-rs/blob/e9be0b6f6d22cd2eb79b0ec08964f82e717e5fe4/crates/tmux-workspace/docs/cli.md).
