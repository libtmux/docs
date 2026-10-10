---
title: "C# workspace builder behavior"
description: "Internal configuration, application, and failure contracts of the C# workspace builder."
port: csharp
product: workspace
sidebar:
  group: Internals
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
directory values remain unchanged after parsing. Call `WorkspaceFile.Resolve`
with the document's directory to resolve relative paths before planning.
Neither parsing nor resolution contacts tmux or checks directory existence.

The default plan refuses an existing session. `WorkspacePlanOptions` can
instead select `Reuse`, `Append`, or `Replace`. Reuse returns the inspected
session unchanged; append adds windows; replace targets the inspected session
while preserving its daemon. These choices do not reconcile arbitrary live
state with the declaration.

## Pane readiness

The default `WorkspaceReadiness.Immediate` sends commands without waiting for
shell readiness or completion. Choose `Cooperative` only when the pane's
startup can acknowledge that it accepts input.

Each application supplies a fresh `LIBTMUX_WORKSPACE_READY` value to each
pane. Startup signals that channel with tmux's `wait-for -S` command. A signal
sent before the wait is preserved. The builder closes its waits and stops
input to a pane whose readiness timeout expires.

This is an explicit startup contract. The builder does not infer readiness
from a cursor or prompt, and a startup signal does not acknowledge completion
of a later workspace command.

## Construction and failures

Inspect `WorkspacePlan.Actions` before calling `ApplyAsync`. Planning records
creation, input, readiness, host-script, final-capture, and conditional-cleanup
actions. Application rechecks the observed daemon and session before running
them. Planning observes an interval rather than a transaction; concurrent
changes can invalidate its preconditions.

Rejected layouts appear in `WorkspaceResult.Unsupported`; their windows
remain available. Other tmux failures raise `WorkspaceBuildException`, whose
`PartialResult` identifies materialized state when available. The action
journal includes failures, uncertain outcomes, and actions never started.
Cancellation during application raises `WorkspaceOperationCanceledException`
with the same partial state and journals.

`CompensateOnFailure` requests cleanup of resources proven to have been
created by that application, under a separate cleanup timeout. Its journal
retains cleanup failures. Neither cancellation nor a thrown exception proves
rollback; inspect the result and live state before retrying.

[Validation and build behavior](https://github.com/libtmux/libtmux-dotnet/blob/ec8b6ab2a4f65e23664f43fba538ba200d4ae8bc/src/LibTmux.Workspace/README.md)
