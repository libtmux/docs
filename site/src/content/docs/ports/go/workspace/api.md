---
title: "Go workspace API"
description: "Reference for Parse, Build, BuildInto, and workspace configuration."
port: go
product: workspace
sidebar:
  label: API
  order: 4
tableOfContents: true
---

The `workspace` module takes core `tmux.Server` and session handles. Parsing
is independent of a running server; building takes a context for deadlines
and cancellation.

## Parse configuration

[`Parse`](/reference/go/workspace-parse/) reads YAML into a
[`Workspace`](/reference/go/workspace-workspace/). Its errors match
`ErrInvalidWorkspace`. Inspect the individual diagnostics to locate unknown
keys or invalid values.

[`Window`](/reference/go/workspace-window/),
[`Pane`](/reference/go/workspace-pane/), and
[`Command`](/reference/go/workspace-command/) let applications construct the
same data in Go. `Bool` preserves tmuxp's supported boolean spellings.

## Build a session

[`Build`](/reference/go/workspace-build/) creates the initial session and owns
a temporary control connection for the duration of construction. It returns
a session and an error; a non-nil error can accompany a partial session.

[`BuildInto`](/reference/go/workspace-buildinto/) populates a supplied session
and preserves the caller's connection ownership.
`Workspace.InitialSessionRequest`
produces the initial request for that workflow.

## Inspect before and after

`Workspace.MissingDirectories` reports working directories absent on the
current machine. It does not make them validation errors. After construction,
inspect live state through the core API rather than reading relations from
the creation handle.

[Build contracts](https://github.com/libtmux/libtmux-go/blob/5f808882015a975a65acc7f9da5b3ff0d5cbdc91/workspace/builder.go); [Configuration contracts](https://github.com/libtmux/libtmux-go/blob/5f808882015a975a65acc7f9da5b3ff0d5cbdc91/workspace/workspace.go).
