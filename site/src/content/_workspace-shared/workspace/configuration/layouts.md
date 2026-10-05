---
description: Arrange panes with tmux layout names or a saved layout.
product: workspace
sidebar:
  group: Configuration
  label: Window layouts
  order: 37
tableOfContents: true
title: Window layouts
---

<!-- port:py -->
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
inspect panes as needed.

## Reference source

[classic.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/classic.py); [main-pane-height.yaml](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/main-pane-height.yaml); [main-pane-height-percentage.yaml](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/main-pane-height-percentage.yaml); [focus-window-and-panes.yaml](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/focus-window-and-panes.yaml); [window-index.yaml](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/window-index.yaml).
<!-- /port -->

<!-- port:ts,rs,go,java,csharp,cxx,swift -->
Choose a layout for each window. `even-horizontal` gives panes equal widths:

```yaml title="layouts.yaml"
session_name: layouts-example
windows:
  - window_name: work
    layout: even-horizontal
    panes: [null, null, null]
```

Other common tmux names include `even-vertical`, `main-horizontal`,
`main-vertical` and `tiled`. Full names avoid version-dependent abbreviation
ambiguity. Available names follow the selected tmux daemon.

## Saved layouts and terminal size

A captured layout describes pane geometry. Loading validates its syntax and
pane capacity, then tmux applies it to the actual window size. Resizing can
change the final dimensions. Use a named layout when exact saved geometry is
unnecessary.

Set window and pane `focus` explicitly when the active target matters. Layout
arrangement and active-pane selection are different settings.

[Capture](../../cli/freeze/) can save a running layout; inspect it before
[reloading](../../guides/export-session/) on a smaller terminal.

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
<!-- port:csharp -->
[CLI source](https://github.com/libtmux/libtmux-dotnet/blob/f77fe776ba67a04abb20ddbbc26cf4a000d63b74/src/LibTmux.Workspace.Cli/README.md).
<!-- /port -->
<!-- port:cxx -->
[CLI source](https://github.com/libtmux/libtmux-cxx/blob/9c8c6a264114277df84c9f6819855093adae5c6e/apps/workspace/README.md).
<!-- /port -->
<!-- port:swift -->
[CLI source](https://github.com/libtmux/libtmux-swift/blob/53c67947879f4976ddf2c43f3c8df7c7671c5b19/Sources/TmuxWorkspaceCLI/README.md).
<!-- /port -->
<!-- /port -->
