---
title: Use the Swift workspace builder
description: Build a workspace, inspect its current layout, and choose its lifetime.
port: swift
product: workspace
sidebar:
  group: Internals
  label: Guides
  order: 2
tableOfContents: true
---

Start with the [complete runnable example](../examples/). It includes the
SwiftPM manifest, a pinned library dependency, imports, an executable entry
point, a private tmux server, and cleanup.

## Describe the layout

A `Workspace` contains ordered windows. Each `WindowPlan` describes a window's
name, layout and panes. Its `PanePlan` values describe commands to send and an
optional starting directory.

The example keeps panes open with `/bin/cat`, so it needs no editor, application
or log file. Replace those choices with commands appropriate for the workspace
before using it as an application launcher.

<a id="build-an-isolated-session"></a>

## Build on a running server

`WorkspaceBuilder.build(_:on:)` checks the server's sessions before creating
its workspace. Start a private bootstrap session first, or pass a running
server whose lifetime the application owns.

The builder rejects an existing session with the requested name. After a
creation failure, it attempts to remove the session it created. Inspect
`WorkspaceBuilderError.rollbackFailed` when both the operation and its rollback
fail; that error preserves both causes.

The example's final cleanup stops its whole private server, including the
bootstrap session. An application that wants the workspace to remain open
should retain its selected server and stop it when the application is done.

## Inspect the completed layout

Request a fresh `Server.snapshot()` after building. The returned session value
was captured when the first window was created; it does not become a live view
as later windows are added.

Use the snapshot's `windows(of:)` and `panes(of:)` methods to inspect membership.
The complete example asserts the final window and pane counts before printing
its result.

## Read configuration

`Workspace.decode(json:)` reads Foundation `Data`. The accepted model uses
`session_name`, `windows`, `window_name` and `panes`; unknown keys are ignored.

YAML input additionally requires the dependency's `YAMLWorkspaces` trait and
`Workspace.decode(yaml:)`. Enable that trait on the package dependency when
using YAML. A dependency trait does not define the same compilation condition
inside a consumer package, so do not wrap the consumer call in an
`#if YAMLWorkspaces` guard.

Swift values and JSON need no YAML dependency. The
[workspace model](https://github.com/libtmux/libtmux-swift/blob/254f8b2be7eb60cacc3ffcb3ea8e456784f582df/Sources/TmuxWorkspace/Workspace.swift)
and [build contract](https://github.com/libtmux/libtmux-swift/blob/254f8b2be7eb60cacc3ffcb3ea8e456784f582df/Sources/TmuxWorkspace/WorkspaceBuilder.swift)
describe the accepted fields and failure behavior.
