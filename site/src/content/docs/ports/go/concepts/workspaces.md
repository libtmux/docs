---
port: go
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

```go
window, err := session.NewWindow(ctx, tmux.NewWindowRequest{Name: tmux.Ptr("dev")})
if err != nil {
	return err
}
// Attach: true makes the split active, so the next split divides it rather
// than the pane that was already there.
terminal, err := window.SplitPane(ctx, tmux.SplitPaneRequest{
	Attach: true, Percentage: tmux.Ptr(30),
})
if err != nil {
	return err
}
if _, err := window.SplitPane(ctx, tmux.SplitPaneRequest{Direction: tmux.PaneDirectionRight}); err != nil {
	return err
}
_ = terminal
return window.SelectLayout(ctx, tmux.SelectLayoutRequest{Layout: "main-vertical"})
```

A split creates a pane; direction and size control its placement. Applying a
layout rearranges existing panes while their processes continue running. tmux provides `even-horizontal`, `even-vertical`, `main-horizontal`,
`main-vertical`, and `tiled` layouts.

Choose detached creation when the user's current window should retain focus.
Splits and resizes issue tmux commands; [Control mode vs one-shot](../transports/)
covers their transport costs and batching.

## Building one declaratively

These packages read or build workspace configurations based on tmuxp:

The `workspace` package loads tmuxp-shaped workspace configurations.
See [Workspace Manager](/workspace/) for the supported fields and CLI.

```go
described, err := workspace.Parse(document)
if err != nil {
	return err
}
session, err := workspace.Build(ctx, server, described)
if err != nil {
    return err
}
fmt.Println("workspace session:", session.ID())
```

## Cleaning up

Use a named error result in the enclosing function so deferred cleanup can
return its own failure. Give cleanup a fresh, bounded context:

```go
// No context manager: defer runs the cleanup at the end of the enclosing
// function instead of the end of a block.
session, err := server.NewSession(ctx, tmux.NewSessionRequest{Name: "temp-session"})
if err != nil {
	return err
}
defer func() {
	cleanupCtx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	err = errors.Join(err, session.Kill(cleanupCtx))
}()
```

See [Context managers](/topics/context-managers/) for cleanup support in each
port. Use explicit kill methods when the handle does not provide scope-based
cleanup.
