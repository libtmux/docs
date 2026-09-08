---
title: ".NET workspace API"
description: "Reference for WorkspaceFile, WorkspaceBuilder, results, readiness, and errors."
port: dotnet
product: workspace
sidebar:
  label: API
  order: 4
tableOfContents: true
---

The `LibTmux.Workspace` namespace provides configuration objects and a builder
that uses a caller-supplied LibTmux `Server`.

## Configuration

[`WorkspaceFile`](/reference/dotnet/libtmux-workspace-workspacefile/) parses
YAML and holds the session description. `WorkspaceWindow` and `WorkspacePane`
hold nested configuration. `WorkspaceFormatException` identifies unsupported
or invalid configuration.

## Builder options

[`WorkspaceBuilder`](/reference/dotnet/libtmux-workspace-workspacebuilder/)
accepts a server, an optional positive readiness timeout, and a
[`PaneReadiness`](/reference/dotnet/libtmux-workspace-panereadiness/) policy.
Its `BuildAsync` accepts the configuration and an optional cancellation token.

The default timeout is ten seconds. `Auto`, `Always`, and `Never` select which
panes wait before command delivery. [Topics](../topics/) explains the prompt
heuristic and its limitations.

## Results and failures

[`WorkspaceResult`](/reference/dotnet/libtmux-workspace-workspaceresult/)
contains the created session, windows, and rejected layouts. A rejected layout
does not discard its window.

[`WorkspaceBuildException`](/reference/dotnet/libtmux-workspace-workspacebuildexception/)
keeps a `PartialResult` when state could be materialized before failure. It
can be null when no such result could be read. Inspect live tmux state before
retrying; a missing result does not prove that no command reached tmux.

[Result contract](https://github.com/libtmux/libtmux-dotnet/blob/6656a563ec9e07ab52e0c3ac96f7704fc94cc0c0/src/LibTmux.Workspace/WorkspaceResult.cs); [Failure contract](https://github.com/libtmux/libtmux-dotnet/blob/6656a563ec9e07ab52e0c3ac96f7704fc94cc0c0/src/LibTmux.Workspace/WorkspaceBuildException.cs).
