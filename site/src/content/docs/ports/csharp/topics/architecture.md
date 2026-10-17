---
port: csharp
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

Session, window, and pane handles carry their ID and server context. Call an
operation on the object you want to change. The examples below send input and
kill that pane.

```csharp
await pane.SendTextAsync("echo hi");
await pane.KillAsync();
```

<a id="a-generated-data-table-under-a-hand-written-surface"></a>

## Reading tmux fields

Object IDs become tmux targets (`-t`). Format variables (`#{...}`) provide
the state returned by tmux.

Typed properties read a dictionary captured from tmux. A property throws
`IncompleteSnapshotException` when the capture did not request its field.
This differs from a captured field whose value is absent.

<a id="module-layout-by-port"></a>

## Source layout

`src/LibTmux/` splits each entity into partial-class files by concern.
For example, `src/LibTmux/Pane.cs`, `src/LibTmux/Pane.Capture.cs`,
`src/LibTmux/Pane.Input.cs`, `src/LibTmux/Pane.Relations.cs`,
`src/LibTmux/Pane.Scopes.cs`, and `src/LibTmux/Pane.Topology.cs` contribute
to one `Pane` type. `Options` and `Hooks` views are reached through the
object's properties.
