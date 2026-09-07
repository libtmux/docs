---
title: ".NET workspace topics"
description: "Understand YAML validation, pane readiness, bootstrap windows, and errors."
port: dotnet
product: workspace
sidebar:
  label: Topics
  order: 1
tableOfContents: true
---

`WorkspaceFile.Parse` produces immutable configuration before building begins.
It rejects duplicate or unknown keys, wrong value shapes, multiple YAML
documents, and inputs over 1 MiB. Missing session names and empty window lists
are rejected before any session is created.

## Supported fields

The package supports session names, working directories, scalar options,
windows, panes, layouts, focus, and scalar or ordered shell commands. Working
directory values pass to tmux unchanged. Relative paths are not rebased to
the directory containing the YAML file.

The builder creates a new session. It does not reconcile an existing one or
run tmuxp plugins and hooks.

## Pane readiness

The default `PaneReadiness.Auto` waits before sending commands to panes using
a zsh session default shell. `Always` waits for every default-shell pane;
`Never` sends immediately. A nonempty session `default-command` skips this
wait under every policy.

The wait polls the current command and cursor position, with a default
ten-second timeout. It writes no probe keys. This is a prompt heuristic:
startup output can resemble readiness, and a prompt at the origin can time
out. It does not acknowledge that a later workspace command was consumed or
that an application became ready.

## Construction and failures

To apply session options before creating the described first window, the
builder temporarily creates a bootstrap window. tmux hooks can observe its
creation and removal, as well as the display calls used for readiness polls.

Rejected layouts appear in `WorkspaceResult.Unsupported`; their windows
remain available. Other tmux failures raise `WorkspaceBuildException`, whose
`PartialResult` identifies materialized state when available. The builder does
not roll back. Inspect that result before choosing cleanup or a retry.

[Validation and build behavior](https://github.com/libtmux/libtmux-dotnet/blob/6656a563ec9e07ab52e0c3ac96f7704fc94cc0c0/src/LibTmux.Workspace/README.md)
