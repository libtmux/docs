---
title: Runtime and configuration support
description: Runtime requirements and configuration boundaries for the Go workspace command.
port: go
product: workspace
sidebar:
  label: Runtime and configuration support
  group: "Reference"
  order: 30
tableOfContents: true
---

`tmux-workspace` is the Go command for loading and capturing tmux
workspaces. The [installation guide](../../guides/installation/) builds the
documented source revision and runs a session on a private socket. The
walkthroughs require tmux 3.2a or newer.

## Runtime and execution

Build with Go 1.26 or newer from the repository root so its workspace modules
are selected together. Ordinary loading, capture, discovery, conversion,
import and search use native Go services.

Search uses Go regular expressions. `--regex-engine python` explicitly selects
the optional Python regex backend. Plugins, custom builders and `shell` need
tmuxp 1.74.0 in the interpreter selected by `TMUX_WORKSPACE_PYTHON`.

Extension append refuses a document containing `before_script`; native
scripted append remains supported. Inspect retained effects before retrying
extension failures.

The Go workspace library has a separate parser and builder contract. In
particular, its accepted fields and variable expansion differ from the CLI.

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

[CLI source](https://github.com/libtmux/libtmux-go/blob/bb06e26e116e941813ca40bf45e7e3a47d38f52a/workspace/CLI.md).
