---
description: Set window names, indexes, layouts, options and focus.
product: workspace
sidebar:
  group: Configuration
  label: Window configuration
  order: 32
tableOfContents: true
title: Window configuration
---

<!-- port:py -->
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
has no environment map; providing a pane map selects that map instead.

## Index, layout, and focus

The classic builder moves the temporary initial window before creating the
configured first window. This permits an explicit first index without reusing
the temporary window's content. Do not assume window list position and tmux
numeric index are identical.

Window options precede layout application. `"options_after"` exists for settings
such as synchronize-panes that should take effect after individual setup
commands. [Layouts](../layouts/) explains named layouts, dimensions, and focus;
[panes](../panes/) describes the pane forms accepted inside a window.

## Reference source

[classic.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/classic.py); [loader.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/loader.py); [2-pane-synchronized.yaml](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/2-pane-synchronized.yaml).
<!-- /port -->

<!-- port:ts,rs,go,java,dotnet,cxx,swift -->
Each item in `windows` creates one window with its own ordered pane list.
Set `window_index` when the tmux index matters independently of list position.

```yaml title="windows.yaml"
session_name: windows-example
windows:
  - window_name: tools
    window_index: 2
    layout: even-horizontal
    focus: true
    options:
      automatic-rename: false
    options_after:
      synchronize-panes: true
    panes:
      - printf left
      - printf right
```

`options` applies during construction. `options_after` applies after initial
pane commands, which is useful for enabling synchronized typing after each pane
has received its own setup. Later input in a synchronized pane can reach the
other panes in that window.

## Launch settings

`start_directory` supplies a directory for panes that do not override it.
`window_shell` supplies their launch command; a pane's `shell` overrides it.
Set `environment` for a window-wide launch map and read
[environment inheritance](../environment/) before overriding it per pane.

Use distinct explicit indexes. `focus: true` selects the window after building.
An explicit [layout](../layouts/) makes the intended arrangement clear across
terminal sizes. [Pane configuration](../panes/) controls each pane's contents.

<!-- port:ts -->
[CLI source](https://github.com/libtmux/libtmux-ts/blob/f36d692552bb9a373b45338bb5fece854e57cc3d/packages/workspace-cli/README.md).
<!-- /port -->
<!-- port:rs -->
[CLI source](https://github.com/libtmux/libtmux-rs/blob/e9be0b6f6d22cd2eb79b0ec08964f82e717e5fe4/crates/tmux-workspace/docs/cli.md).
<!-- /port -->
<!-- port:go -->
[CLI source](https://github.com/libtmux/libtmux-go/blob/bb06e26e116e941813ca40bf45e7e3a47d38f52a/workspace/CLI.md).
<!-- /port -->
<!-- port:java -->
[CLI source](https://github.com/libtmux/libtmux-java/blob/3e5b20d22af3890ae5f7f52842e4b05d170a983f/libtmux-workspace-cli/README.md).
<!-- /port -->
<!-- port:dotnet -->
[CLI source](https://github.com/libtmux/libtmux-dotnet/blob/f77fe776ba67a04abb20ddbbc26cf4a000d63b74/src/LibTmux.Workspace.Cli/README.md).
<!-- /port -->
<!-- port:cxx -->
[CLI source](https://github.com/libtmux/libtmux-cxx/blob/9c8c6a264114277df84c9f6819855093adae5c6e/apps/workspace/README.md).
<!-- /port -->
<!-- port:swift -->
[CLI source](https://github.com/libtmux/libtmux-swift/blob/53c67947879f4976ddf2c43f3c8df7c7671c5b19/Sources/TmuxWorkspaceCLI/README.md).
<!-- /port -->
<!-- /port -->
