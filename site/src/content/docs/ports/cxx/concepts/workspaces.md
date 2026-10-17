---
port: cxx
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

```cpp
const auto window = session.new_window({.name = "dev"});
if (!window.has_value()) return 1;

// `focus = true` makes the new pane active, so the next split divides it.
const auto terminal = window->split({.percentage = 30, .focus = true});
if (!terminal.has_value()) return 1;

const auto logs = window->split({.horizontal = true});
if (!logs.has_value()) return 1;

(void)window->select_layout("main-vertical");
```

A split creates a pane; direction and size control its placement. Applying a
layout rearranges existing panes while their processes continue running. tmux provides `even-horizontal`, `even-vertical`, `main-horizontal`,
`main-vertical`, and `tiled` layouts.

Choose detached creation when the user's current window should retain focus.
Splits and resizes issue tmux commands; [Control mode vs one-shot](../transports/)
covers their transport costs and batching.

## Building one declaratively

These packages read or build workspace configurations based on tmuxp:

C++ provides a consumer example in `examples/workspace/` that reads tmuxp
configuration. The workspace builder is part of that example, rather than a
library package:

```cpp
// Not a package: this is the examples/workspace/ consumer, showing the
// shape a tmuxp document builds into rather than a library entry point.
const workspace::Workspace description{
    .session_name = "dev",
    .windows = {{.name = "editor", .panes = {{}, {}}}}};
const auto built = workspace::build(server, description);
```

## Cleaning up

See [Context managers](/topics/context-managers/) for cleanup support in each
port. Use explicit kill methods when the handle does not provide scope-based
cleanup.
