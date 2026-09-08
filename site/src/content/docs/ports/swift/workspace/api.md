---
title: "Swift workspace API"
description: "Reference for workspace values, decoding, building, and typed failures."
port: swift
product: workspace
sidebar:
  label: API
  order: 4
tableOfContents: true
---

Import `TmuxWorkspace` for the configuration and builder, and [`LibTmux`](/reference/swift/) for
the server and returned session value.

## Configuration values

[`Workspace`](/reference/swift/workspace/) contains the session name, optional
working directory, and ordered windows. `WindowPlan` contains its name,
directory, layout, and panes. `PanePlan` contains its directory and commands.
The values conform to `Sendable`, `Hashable`, and `Codable`.

`Workspace.decode(json:)` reads JSON data. `Workspace.decode(yaml:)` reads a
string only when `YAMLWorkspaces` is enabled. Encoding these values writes the
existing description; it does not query tmux for a live export.

## Builder

[`WorkspaceBuilder`](/reference/swift/workspacebuilder/) exposes the async
`build(_:on:)` operation. It creates a new session on the supplied server and
returns a `Session`. Keep using the server for live observation; session
properties do not refresh themselves.

## Typed errors

[`WorkspaceBuilderError`](/reference/swift/workspacebuildererror/) distinguishes
an empty window list, an existing session name, a vanished session, underlying
tmux errors, and failure of rollback.

`rollbackFailed(original:cleanup:)` preserves both causes. The caller can
report the initiating problem and separately inspect whether cleanup left
objects behind. The supplied server remains owned by the caller.

[Value and decoding contracts](https://github.com/libtmux/libtmux-swift/blob/f02a4668570e1cc5198c941413750e021f42c214/Sources/TmuxWorkspace/Workspace.swift); [Builder contract](https://github.com/libtmux/libtmux-swift/blob/f02a4668570e1cc5198c941413750e021f42c214/Sources/TmuxWorkspace/WorkspaceBuilder.swift).
