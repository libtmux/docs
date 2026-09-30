---
title: Runtime and configuration support
description: Runtime requirements and configuration boundaries for the Swift workspace command.
port: swift
product: workspace
sidebar:
  label: Runtime and configuration support
  group: "Reference"
  order: 30
tableOfContents: true
---

`tmux-workspace` is the Swift command for loading and capturing tmux
workspaces. The [installation guide](../../guides/installation/) builds the
documented source revision and runs a session on a private socket. The
walkthroughs require tmux 3.2a or newer.

## Runtime and execution

Use Swift 6.2. YAML decoding requires the `YAMLWorkspaces` build trait;
JSON documents work without it. Keep the matching runtime libraries available
when running a source-built Linux executable.

Native services handle loading, capture, discovery, search, conversion, import
and editing. Search uses ICU regular expressions. Select an explicit endpoint
with `-S` or `-L` when loading outside tmux.

Set delays on panes. Command mappings support Enter overrides but reject
per-command timing fields. Plugins and custom workspace builders are
unsupported. The optional inspection `shell` requires tmuxp 1.74.0 in the
interpreter selected by `TMUX_WORKSPACE_PYTHON`.

The `TmuxWorkspace` library has a separate model and construction API. Consult
its reference when building sessions from Swift code.

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

[CLI source](https://github.com/libtmux/libtmux-swift/blob/53c67947879f4976ddf2c43f3c8df7c7671c5b19/Sources/TmuxWorkspaceCLI/README.md).
