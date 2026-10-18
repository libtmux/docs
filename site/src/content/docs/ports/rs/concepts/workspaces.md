---
port: rs
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
command. These calls use `libtmux_tokio` handles:

```rust
let mut window = session.new_window("dev").await?;
let main_pane = window.active_pane().await?.expect("a new window has a pane");

let terminal_pane = main_pane
    .split(SplitOptions::new(SplitDirection::Below).size(PaneSize::Percent(30)))
    .await?;
let logs_pane = terminal_pane
    .split(SplitOptions::new(SplitDirection::Right))
    .await?;

window.select_layout(Layout::MainVertical).await?;
```

A split creates a pane; direction and size control its placement. Applying a
layout rearranges existing panes while their processes continue running. tmux
provides `even-horizontal`, `even-vertical`, `main-horizontal`,
`main-vertical`, and `tiled` layouts.

Choose detached creation when the user's current window should retain focus.
Splits and resizes issue tmux commands; [Control mode vs one-shot](../transports/)
covers their transport costs and batching.

## Building one declaratively

These packages read or build workspace configurations based on tmuxp:

The `tmux-workspace` crate loads tmuxp-shaped configurations and takes a
`libtmux_tokio::Server`. Use that package's handles with its async builder.
See [Workspace Manager](/workspace/) for the supported fields and CLI.

```rust
use tmux_workspace::{Workspace, WorkspaceBuilder};

let workspace = Workspace::from_yaml(yaml_source)?;
let session = WorkspaceBuilder::new(&server).build(&workspace).await?;
```

## Cleaning up

See [Context managers](/topics/context-managers/) for cleanup support in each
port. Use explicit kill methods when the handle does not provide scope-based
cleanup.
