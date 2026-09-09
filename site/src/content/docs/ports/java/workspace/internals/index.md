---
title: "Java workspace internals"
description: "Architecture and development interfaces of the Java workspace builder."
port: java
product: workspace
sidebar:
  label: Overview
  group: Internals
  order: 0
tableOfContents: true
---

These pages document the in-development workspace builder for contributors
and applications that call its APIs. For workspace loading from a terminal,
see [tmuxp](https://tmuxp.git-pull.com/).

## Builder pipeline

The public `WorkspaceBuilder` facade reads or parses YAML into immutable
configuration records, then builds through a supplied core `Server`.
Parsing and applying use separate package-private helpers. The caller owns
command-line handling, attachment, and the server connection.

## Read the implementation

- [Guides](./guides/) show builder setup and application code.
- [Topics](./topics/) explain configuration, behavior, and failures.
- [Examples](./examples/) exercise the builder through the language API.
- [API](./api/) links the configuration and construction interfaces.

## Implementation scope

`libtmux-workspace` builds a new tmux session from a YAML description. It uses
libtmux's Java API and returns the session after capturing the completed
window and pane structure.

The module supports a focused [tmuxp](https://tmuxp.git-pull.com) subset:
session names, windows, layouts, panes, and ordered shell commands. It rejects
unknown configuration fields instead of accepting a larger file with missing
behavior.

## Package and runtime

Use the [`io.github.libtmux:libtmux-workspace`](https://central.sonatype.com/artifact/io.github.libtmux/libtmux-workspace) artifact with the libtmux BOM.
The module targets Java 21 and requires tmux on the host for building. Parsing
YAML does not create a session.

This module does not load Python plugins or implement tmuxp's CLI. Use the
[Python workspace documentation](https://tmuxp.git-pull.com/) when those
features are required.

[Module documentation](https://github.com/libtmux/libtmux-java/blob/4f057d367a25dee818d70876fa283fc503a3a7eb/libtmux-workspace/README.md)
