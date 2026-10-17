---
port: swift
route: topics/architecture
title: Architecture
description: Locate operations, distinguish snapshots from live commands, and find their implementation.
sidebar:
  label: Architecture
  group: Topics
  order: 2
tableOfContents: true
---

A server handle selects a tmux server. Object IDs select sessions, windows, and
panes within it. For the object hierarchy and stable IDs, start with [Server,
session, window, pane](/concepts/server-session-window-pane/).

<a id="where-behavior-lives-on-the-object-or-through-the-server"></a>

## Calling operations

Swift's `Session`, `Window`, and `Pane` are `Sendable` value types holding IDs
and state fields. [Format-token fields](../format-tokens/) lists their fields.
Perform operations through `Server`, passing the target value:

```swift
try await server.sendKeys(["echo hi", "Enter"], to: pane)
try await server.kill(pane)
```

Keep the `Server` that produced the snapshot. Pass its captured values back to
that server for operations.

<a id="a-generated-data-table-under-a-hand-written-surface"></a>

## Reading tmux fields

Object IDs become tmux targets (`-t`). Format variables (`#{...}`) provide
the state returned by tmux.

Snapshots capture a fixed set of non-optional fields, including indices,
dimensions, active state, command, path, and edge flags.
[Format-token fields](../format-tokens/) covers other tokens.

<a id="module-layout-by-port"></a>

## Source layout

`Sources/LibTmux/Server.swift` defines `Server`. `Sources/LibTmux/Session.swift`,
`Sources/LibTmux/Window.swift`, and `Sources/LibTmux/Pane.swift` define the
snapshot value types. `Sources/LibTmux/Snapshot.swift` implements the
[relationship queries](../traversal/).

Extensions on `Server` group related operations:
`Sources/LibTmux/Options.swift` implements options and hooks,
`Sources/LibTmux/PaneInteraction.swift` handles input and capture, and
`Sources/LibTmux/Mutations.swift` handles changes such as killing a pane.
