---
title: "Workspace layouts and focus"
description: "Tmuxp workspace layouts and focus and current .NET builder compatibility."
port: dotnet
product: workspace
sidebar:
  group: Configuration
  label: "Layouts and focus"
  order: 37
tableOfContents: true
---

**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.

A window's `"layout"` chooses how tmux arranges its panes. Named layouts adapt to
the window size; explicit layout strings describe geometry more directly. The
selected tmux version and terminal dimensions affect the final result.

```yaml
session_name: layout-example
windows:
  - window_name: main
    layout: main-horizontal
    focus: true
    options:
      main-pane-height: 60%
    panes:
      - shell_command: echo main pane
        focus: true
      - echo first lower pane
      - echo second lower pane
```

## Layout names and options

Common tmux layout names are even-horizontal, even-vertical, main-horizontal,
main-vertical, and tiled. Layout availability belongs to the target tmux
version. Options such as main-pane-height and main-pane-width shape applicable
main-pane layouts. A row/column count and a percentage are different values;
preserve that distinction in YAML/JSON.

The classic builder applies window options before selecting a layout and applies
options_after after panes and their setup commands. This lets a workspace size
its main pane while delaying synchronize-panes until individual setup is
complete.

An explicit layout string can depend on the current number of panes and window
size. A layout captured from one terminal is a starting point to inspect on
another, not a portable pixel diagram.

## Terminal dimensions

When TMUXP_DETECT_TERMINAL_SIZE is 1 (the default), the classic builder asks
Python's terminal-size helper for initial session dimensions. COLUMNS and LINES
can influence that helper. Fallback width uses TMUXP_DEFAULT_COLUMNS, then
COLUMNS, then 80. Fallback height uses TMUXP_DEFAULT_ROWS, then ROWS, with
nominal default 24.

The helper can choose terminal dimensions instead of its fallback, so a
TMUXP_DEFAULT value alone is not an unconditional size override. Detached
sessions also need dimensions for reproducible layouts. Invalid numeric
environment values can fail before useful construction.

## Focus and indexes

Set window focus to select that window after construction, and pane focus to
select the active pane within its window. Prefer one focused window and one
focused pane per window; multiple true values depend on build order and are
harder to reason about.

A window_index selects its numeric tmux position. Pane IDs such as `%3` are
runtime identities, not YAML pane list positions. Base-index and pane-base-index
settings can make visible indexes differ from zero-based list positions.

Inspect a running workspace's geometry and selection:

```console
$ tmux -L layout-example list-windows -t '=layout-example'
```

This command assumes the sample workspace was loaded on the dedicated
layout-example socket. Use [load](../../cli/load/) to select that socket, then
inspect panes as needed. A successful load does not prove every native port
honors the same focus/index/options policy.

## Current .NET builder

Rejected layouts are reported in `WorkspaceResult.Unsupported` while the
corresponding windows remain available. Other build failures raise an exception
with partial result information.

See the [native builder behavior](../../internals/topics/) and [configuration
source](https://github.com/libtmux/libtmux-dotnet/blob/b71b9654f41785c93717e454cbf176672b3d634a/src/LibTmux.Workspace/WorkspaceYamlParser.cs)
before using these fields through application code.

## Reference source

[classic.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/classic.py); [main-pane-height.yaml](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/main-pane-height.yaml); [main-pane-height-percentage.yaml](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/main-pane-height-percentage.yaml); [focus-window-and-panes.yaml](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/focus-window-and-panes.yaml); [window-index.yaml](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/window-index.yaml).
