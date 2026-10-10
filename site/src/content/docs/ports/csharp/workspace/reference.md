---
title: "C# workspace builder API"
description: "Internal reference for the C# workspace builder and configuration APIs."
port: csharp
product: workspace
sidebar:
  group: Internals
  label: API
  order: 4
tableOfContents: true
---

The `LibTmux.Workspace` namespace provides configuration objects and a builder
that uses a caller-supplied LibTmux `Server`.

## Configuration

[`WorkspaceFile`](./libtmux-workspace-workspacefile/) parses
YAML and holds the session description. `WorkspaceWindow` and `WorkspacePane`
hold nested configuration. `WorkspaceFormatException` identifies unsupported
or invalid configuration.

## Builder options

[`WorkspaceBuilder`](./libtmux-workspace-workspacebuilder/) accepts the server
to use. `PlanAsync` validates the declaration and observes that endpoint;
its returned [`WorkspacePlan`](./libtmux-workspace-workspaceplan/) lists the
actions to review before `ApplyAsync` executes them. Enumerating those actions
performs no I/O. Application rechecks the observed daemon and session.

[`WorkspacePlanOptions`](./libtmux-workspace-workspaceplanoptions/) controls
existing-session conflicts, readiness, host scripts, and cleanup. The defaults
refuse an existing session and send pane input immediately. `BuildAsync`
combines planning and application with those defaults.

Choose [`WorkspaceReadiness.Cooperative`](./libtmux-workspace-workspacereadiness/)
when pane startup can signal its assigned channel. Configure a positive
`ReadinessTimeout`; a timeout prevents command delivery to that pane.
[Topics](../topics/) explains the startup contract and its limits.

## Results and failures

[`WorkspaceResult`](./libtmux-workspace-workspaceresult/)
contains the session, created windows, rejected final layouts, and action
journals. Reusing an existing session creates no windows. A rejected final
layout does not discard its window.

[`WorkspaceBuildException`](./libtmux-workspace-workspacebuildexception/)
keeps a `PartialResult` when state could be materialized before failure. It
can be null when no such result could be read. `Journal` records action
outcomes; `CompensationJournal` records attempted cleanup. Inspect live tmux
state before retrying; a missing result does not prove that no command reached
tmux.

Cancellation during application raises
[`WorkspaceOperationCanceledException`](./libtmux-workspace-workspaceoperationcanceledexception/)
with the caller's token, partial state, and journals. Cancellation does not
imply rollback. `CompensateOnFailure` requests bounded cleanup only of
resources proven to belong to that application.

[Result contract](https://github.com/libtmux/libtmux-dotnet/blob/ec8b6ab2a4f65e23664f43fba538ba200d4ae8bc/src/LibTmux.Workspace/WorkspaceResult.cs); [Failure contract](https://github.com/libtmux/libtmux-dotnet/blob/ec8b6ab2a4f65e23664f43fba538ba200d4ae8bc/src/LibTmux.Workspace/WorkspaceBuildException.cs).
