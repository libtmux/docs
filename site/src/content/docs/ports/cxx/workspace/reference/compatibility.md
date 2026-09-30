---
title: Runtime and configuration support
description: Runtime requirements and configuration boundaries for the C++ workspace command.
port: cxx
product: workspace
sidebar:
  label: Runtime and configuration support
  group: "Reference"
  order: 30
tableOfContents: true
---

`tmux-workspace` is the C++ command for loading and capturing tmux
workspaces. The [installation guide](../../guides/installation/) builds the
documented source revision and runs a session on a private socket. The
walkthroughs require tmux 3.2a or newer.

## Runtime and execution

Build with the repository's `cxx-dev` CMake preset and its selected compiler.
Native services handle loading, capture, discovery, search, conversion, import
and editing. Search uses C++ ECMAScript regular expressions.

Plugins and custom workspace builders are unsupported. `shell` is a separate
optional feature that runs tmuxp 1.74.0; select its interpreter with
`TMUX_WORKSPACE_PYTHON`, or select the executable with `TMUX_WORKSPACE_TMUXP`.

Use detached loading when no unambiguous controlling terminal or tmux client
is available. Append retains its borrowed session and reports changes that
remain after a failure.

The workspace library has its own configuration and construction APIs; use
their reference for C++ application code.

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

[CLI source](https://github.com/libtmux/libtmux-cxx/blob/9c8c6a264114277df84c9f6819855093adae5c6e/apps/workspace/README.md).
