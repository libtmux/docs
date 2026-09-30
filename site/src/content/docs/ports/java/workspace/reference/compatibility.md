---
title: Runtime and configuration support
description: Runtime requirements and configuration boundaries for the Java workspace command.
port: java
product: workspace
sidebar:
  label: Runtime and configuration support
  group: "Reference"
  order: 30
tableOfContents: true
---

`tmux-workspace` is the Java command for loading and capturing tmux
workspaces. The [installation guide](../../guides/installation/) builds the
documented source revision and runs a session on a private socket. The
walkthroughs require tmux 3.2a or newer.

## Runtime and execution

Use JDK 25 or newer. Keep the generated application distribution together;
its launcher depends on the adjacent libraries. Native services handle loading,
capture, discovery, search, conversion, import and editing.

Plugins, custom builders and `shell` need the optional tmuxp 1.74.0 environment
selected by `TMUX_WORKSPACE_PYTHON`. Extension append refuses a document
containing `before_script` to preserve its borrowed session on failure.

The CLI validates execution fields before changing tmux. Use the separate
workspace library reference when constructing sessions from Java code.

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

[CLI source](https://github.com/libtmux/libtmux-java/blob/3e5b20d22af3890ae5f7f52842e4b05d170a983f/libtmux-workspace-cli/README.md).
