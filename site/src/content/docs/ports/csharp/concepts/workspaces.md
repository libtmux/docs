---
port: csharp
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

```csharp
Window window = await session.CreateWindowAsync(new NewWindowRequest(name: "dev"));
Pane main = (await window.GetPanesAsync())[0];

Pane terminal = await main.SplitAsync(new SplitPaneRequest(percentage: 30));
Pane logs = await terminal.SplitAsync(new SplitPaneRequest(direction: PaneDirection.Right));

await window.SelectLayoutAsync(new SelectLayoutRequest("main-vertical"));
```

A split creates a pane; direction and size control its placement. Applying a
layout rearranges existing panes while their processes continue running. tmux provides `even-horizontal`, `even-vertical`, `main-horizontal`,
`main-vertical`, and `tiled` layouts.

Choose detached creation when the user's current window should retain focus.
Splits and resizes issue tmux commands; [Control mode vs one-shot](../transports/)
covers their transport costs and batching.

## Building one declaratively

These packages read or build workspace configurations based on tmuxp:

`LibTmux.Workspace` reads tmuxp YAML. See [Workspace Manager](/workspace/)
for configuration fields and the CLI.

```csharp
WorkspaceFile workspace = WorkspaceFile.Parse(yaml);
WorkspaceResult result = await new WorkspaceBuilder(server).BuildAsync(workspace, ct);
```

## Cleaning up

An ownership scope kills its session when `await using` exits:

```csharp
await using OwnedSessionScope scope = await server.CreateOwnedSessionAsync(
    new NewSessionRequest(name: "temp-session"));
Window window = (await scope.Value.GetWindowsAsync())[0];
Pane pane = (await window.GetPanesAsync())[0];

await pane.SendTextAsync("echo temporary workspace");
// session is gone here, even if an exception unwound through the block
```

See [Context managers](/topics/context-managers/) for cleanup support in each
port. Use explicit kill methods when the handle does not provide scope-based
cleanup.
