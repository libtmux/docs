---
title: Runtime and configuration support
description: Runtime requirements and configuration boundaries for the .NET workspace command.
port: dotnet
product: workspace
sidebar:
  label: Runtime and configuration support
  group: "Reference"
  order: 30
tableOfContents: true
---

`tmux-workspace` is the .NET command for loading and capturing tmux
workspaces. The [installation guide](../../guides/installation/) builds the
documented source revision and runs a session on a private socket. The
walkthroughs require tmux 3.2a or newer.

## Runtime and execution

The CLI has .NET 8 and .NET 10 builds. Keep the selected runtime available,
or install the packaged .NET tool. Native services handle loading, capture,
discovery, search, conversion, import and editing.

Plugins, custom builders and `shell` use an optional interpreter with tmuxp
1.74.0. Set `TMUX_WORKSPACE_PYTHON` to select it. Use detached loading for
extension workspaces when terminal handoff is unavailable.

`LibTmux.Workspace` is a separate library API. Its parser and builder contract
does not define every configuration feature accepted by the CLI.

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

[CLI source](https://github.com/libtmux/libtmux-dotnet/blob/f77fe776ba67a04abb20ddbbc26cf4a000d63b74/src/LibTmux.Workspace.Cli/README.md).
