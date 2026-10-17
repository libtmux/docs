---
port: swift
route: concepts/workspaces
title: Workspaces
description: Build pane layouts with the object API or a workspace configuration file.
sidebar:
  label: Workspaces
  group: Concepts
  order: 5
tableOfContents: true
---

A workspace arranges windows and panes for a task, such as editing code, running
a development server, and following logs. Build it with the object API when the
layout depends on program logic. Use a declarative builder when you want to
store the layout in a configuration file, such as
[tmuxp](https://tmuxp.git-pull.com/) YAML or JSON.

## Building one imperatively

Create a window, split it into panes, apply a layout, and send each pane its
command:

```swift
let session = try await server.newSession(named: "work")
let window = try await server.newWindow(in: session, named: "dev").window

let terminal = try await server.splitWindow(window, size: .percentage(30))
let logs = try await server.split(terminal, direction: .right)

try await server.selectLayout(window, "main-vertical")
```

A split creates a pane; direction and size control its placement. Applying a
layout rearranges existing panes while their processes continue running. tmux provides `even-horizontal`, `even-vertical`, `main-horizontal`,
`main-vertical`, and `tiled` layouts.

Choose detached creation when the user's current window should retain focus.
Splits and resizes issue tmux commands; [Control mode vs one-shot](../transports/)
covers their transport costs and batching.

## Building one declaratively

These packages read or build workspace configurations based on tmuxp:

`TmuxWorkspace` accepts configurations written in Swift, JSON, or YAML.
YAML support requires the `YAMLWorkspaces` trait.

```swift
let workspace = Workspace(
    sessionName: "work",
    windows: [WindowPlan(windowName: "editor", panes: [PanePlan(), PanePlan()])]
)
let session = try await WorkspaceBuilder.build(workspace, on: server)
```

## Cleaning up

See [Context managers](/topics/context-managers/) for cleanup support in each
port. Use explicit kill methods when the handle does not provide scope-based
cleanup.
