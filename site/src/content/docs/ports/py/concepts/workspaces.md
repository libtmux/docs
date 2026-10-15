---
port: py
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

```python
def create_dev_workspace(session, name='dev'):
    window = session.new_window(window_name=name, attach=False)
    window.resize(height=50, width=160)

    main_pane = window.active_pane
    terminal_pane = main_pane.split(size='30%')
    log_pane = terminal_pane.split(direction=PaneDirection.Right)

    return {'window': window, 'main': main_pane,
            'terminal': terminal_pane, 'logs': log_pane}
```

A split creates a pane; direction and size control its placement. Applying a
layout rearranges existing panes while their processes continue running. tmux provides `even-horizontal`, `even-vertical`, `main-horizontal`,
`main-vertical`, and `tiled` layouts.

Choose detached creation when the user's current window should retain focus.
Splits and resizes issue tmux commands; [Control mode vs one-shot](../transports/)
covers their transport costs and batching.

`attach=False` keeps a newly created window in the background.

## Building one declaratively

These packages read or build workspace configurations based on tmuxp:

`tmuxp` loads a workspace configuration and creates its sessions, windows,
and panes. See [Workspace Manager](/workspace/) for its configuration and CLI.

## Cleaning up

`Window` and `Session` context managers kill their objects on block exit,
including when the block raises:

```python
with session.new_window(window_name='temp-window') as temp_win:
    pane = temp_win.active_pane
    pane.send_keys('echo "temporary workspace"')
# window is gone here, even if the block raised
```

See [Context managers](/topics/context-managers/) for cleanup support in each
port. Use explicit kill methods when the handle does not provide scope-based
cleanup.
