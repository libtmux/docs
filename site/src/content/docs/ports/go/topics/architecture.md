---
port: go
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

```go
cmd := "printf 'hello\\n'"
if err := pane.SendKeys(ctx, tmux.SendKeysRequest{Command: &cmd, Literal: true}); err != nil {
    return err
}
if err := pane.Kill(ctx); err != nil {
    return err
}
```

<a id="a-generated-data-table-under-a-hand-written-surface"></a>

## Reading tmux fields

Object IDs become tmux targets (`-t`). Format variables (`#{...}`) provide
the state returned by tmux.

`tmux/format_generated.go` defines format fields, and
`tmux/option_generated.go` defines options. The format generator lives in
`tmux/internal/generate/formats/`. Accessors return a value and a boolean
when a field can be unavailable; check the boolean before using the value.

<a id="module-layout-by-port"></a>

## Source layout

The `tmux` package groups its implementation by concern. `tmux/model.go`
defines the core structs. `tmux/lifecycle_kill.go`, `tmux/pane_capture.go`,
`tmux/pane_geometry.go`, and `tmux/hierarchy.go` implement lifecycle,
capture, geometry, and traversal. `tmux/plan_server.go` combines commands
into fewer invocations.

`tmuxq/` provides predicate queries over an already-read snapshot; see
[Filtering and queries](/concepts/queries/). Workspace support lives in
`workspace/`.
