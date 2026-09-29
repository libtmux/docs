---
title: Runtime and configuration support
description: Runtime requirements and configuration boundaries for the TypeScript workspace command.
port: ts
product: workspace
sidebar:
  label: Runtime and configuration support
  group: "Reference"
  order: 30
tableOfContents: true
---

`tmux-workspace` is the TypeScript command for loading and capturing tmux
workspaces. The [installation guide](../../guides/installation/) builds the
documented source revision and runs a session on a private socket. The
walkthroughs require tmux 3.2a or newer.

## Runtime and execution

The CLI runs on Node.js 22 or newer and can be built with Bun. Use the
installation guide for the documented revision. Ordinary load, capture,
discovery, search, conversion and import use native services.

Search uses JavaScript regular expressions. Explicit plugins, custom workspace
builders and `shell` use an optional interpreter with tmuxp 1.74.0. Select it
with `TMUX_WORKSPACE_PYTHON`. Empty extension selections keep native execution.

The CLI and `@libtmux/workspace` are separate implementations. The library's
convergence API and strict schema have a different contract from CLI loading.

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

[CLI source](https://github.com/libtmux/libtmux-ts/blob/f36d692552bb9a373b45338bb5fece854e57cc3d/packages/workspace-cli/README.md).
