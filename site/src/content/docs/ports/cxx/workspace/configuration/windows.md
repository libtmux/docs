---
title: "Window configuration"
description: "Tmuxp window configuration and current C++ builder compatibility."
port: cxx
product: workspace
sidebar:
  group: Configuration
  label: "Windows"
  order: 32
tableOfContents: true
---

**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.

Each item in `"windows"` describes one window and its ordered panes. Set
`"window_name"` when the name matters; an omitted name lets tmux choose it.
`"window_index"` selects a tmux numeric index independently of the item's position
in the list.

```yaml
session_name: window-example
start_directory: ./
windows:
  - window_name: tools
    window_index: 1
    start_directory: ./
    layout: even-horizontal
    focus: true
    options:
      automatic-rename: false
    options_after:
      synchronize-panes: true
    panes:
      - echo left
      - echo right
```

This configuration sends each pane its own initial command before enabling
synchronized input. Later typing in one synchronized pane can affect the other
pane.

## Window keys

| Key | Meaning |
| --- | --- |
| `"window_name"` | Label used by tmux; shell variables are expanded |
| `"window_index"` | Explicit numeric position, otherwise use tmux's available index |
| `"panes"` | Ordered pane list; omission supplies one blank pane |
| `"layout"` | Named tmux layout or explicit layout description |
| `start_directory` | Directory inherited by panes unless a pane overrides it |
| `"window_shell"` | Initial shell/application for panes, subject to pane shell override |
| `focus` | Select the window after building |
| `"options"` | Window options applied during creation |
| `"options_after"` | Window options applied after panes and their initial commands |
| `"environment"` | Launch environment used when a pane lacks its own map |
| `shell_command_before` | Commands prepended after session before commands |
| `"suppress_history"` | Window default overriding the session history policy |

## First pane and later panes

A new window already has its initial pane. Tmuxp uses the first configured
pane's start_directory, shell, and environment when launching that window, then
creates splits for later panes. A first-pane override therefore matters during
new-window, not only while creating splits.

A pane shell overrides window_shell. Window environment is used when the pane
has no environment map; providing a pane map selects that map instead. These
rules have native-port differences, so use the current builder note on this
page.

## Index, layout, and focus

The classic builder moves the temporary initial window before creating the
configured first window. This permits an explicit first index without reusing
the temporary window's content. Do not assume window list position and tmux
numeric index are identical.

Window options precede layout application. `"options_after"` exists for settings
such as synchronize-panes that should take effect after individual setup
commands. [Layouts](../layouts/) explains named layouts, dimensions, and focus;
[panes](../panes/) describes the pane forms accepted inside a window.

## Current C++ builder

Names, indexes, directories, environment, options, layouts, focus, and
options_after are supported in the subset. Inspect actual creation order and
current tmux state when matching reference semantics.

See the [native builder behavior](../../internals/topics/) and [configuration
source](https://github.com/libtmux/libtmux-cxx/blob/c7f1146d2ebd7a8323d9f9814517dc3cdf86b4ee/examples/workspace/src/tmuxp.cpp)
before using these fields through application code.

## Reference source

[classic.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/classic.py); [loader.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/loader.py); [2-pane-synchronized.yaml](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/2-pane-synchronized.yaml).
