---
title: "Java workspace API"
description: "Public builder methods and immutable workspace configuration records."
port: java
product: workspace
sidebar:
  label: API
  order: 4
tableOfContents: true
---

The [`io.github.libtmux.workspace`](https://github.com/libtmux/libtmux-java/tree/4f057d367a25dee818d70876fa283fc503a3a7eb/libtmux-workspace/src/main/java/io/github/libtmux/workspace) package exposes the builder facade and
configuration records. Applications can parse YAML or construct the records
before building through a core `Server`.

## Builder facade

[`WorkspaceBuilder`](/reference/java/io-github-libtmux-workspace-workspacebuilder-workspacebuilder/)
provides three static entry points:

- `read(Path)` reads a YAML file and wraps I/O errors in `UncheckedIOException`.
- `parse(String)` reads YAML text and rejects invalid descriptions.
- `build(Server, Workspace)` creates the session and returns a refreshed handle.

Parsing and reading do not contact tmux. Build-time checks include the target
server's support for the requested layout.

## Configuration records

[`Workspace`](/reference/java/io-github-libtmux-workspace-workspace-workspace/)
holds the session name and ordered windows.
[`WindowSpec`](/reference/java/io-github-libtmux-workspace-windowspec-windowspec/)
holds the name, optional layout, and panes.
[`PaneSpec`](/reference/java/io-github-libtmux-workspace-panespec-panespec/)
holds the ordered shell commands.

These records copy their lists so later changes to an input list do not alter
a description already constructed. They describe the supported Java subset;
they are not Python plugin or tmuxp runtime extension interfaces.

## Errors and lifetime

Invalid configuration raises `IllegalArgumentException`. Build failures keep
the original exception and attach cleanup failures as suppressed exceptions.
The caller retains ownership of the supplied server and the successful
session. Use the core session API for later inspection or removal.

[Public builder contract](https://github.com/libtmux/libtmux-java/blob/4f057d367a25dee818d70876fa283fc503a3a7eb/libtmux-workspace/src/main/java/io/github/libtmux/workspace/WorkspaceBuilder.java)
