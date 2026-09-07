---
title: "Workspace Manager for Java"
description: "Build tmux sessions from validated YAML with libtmux-workspace."
port: java
product: workspace
sidebar:
  label: Overview
  order: 0
tableOfContents: true
---

`libtmux-workspace` builds a new tmux session from a YAML description. It uses
libtmux's Java API and returns the session after capturing the completed
window and pane structure.

The module supports a focused tmuxp subset: session names, windows, layouts,
panes, and ordered shell commands. It rejects unknown configuration fields
instead of accepting a larger file with missing behavior.

## Start here

- [Guides](./guides/) add the dependency and build a workspace.
- [Topics](./topics/) explain validation, construction order, and cleanup.
- [Examples](./examples/) show the module's documented build result.
- [API](./api/) covers the public builder and configuration records.

## Package and runtime

Use the [`io.github.libtmux:libtmux-workspace`](https://central.sonatype.com/artifact/io.github.libtmux/libtmux-workspace) artifact with the libtmux BOM.
The module targets Java 21 and requires tmux on the host for building. Parsing
YAML does not create a session.

This module does not load Python plugins or implement tmuxp's CLI. Use the
[Python workspace documentation](https://tmuxp.git-pull.com/) when those
features are required.

[Module documentation](https://github.com/libtmux/libtmux-java/blob/4f057d367a25dee818d70876fa283fc503a3a7eb/libtmux-workspace/README.md)
