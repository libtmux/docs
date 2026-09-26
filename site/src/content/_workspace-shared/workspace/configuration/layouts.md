---
description: Tmuxp workspace layouts and focus, field meanings, defaults, and execution behavior.
product: workspace
sidebar:
  group: Configuration
  label: Layouts and focus
  order: 37
tableOfContents: true
title: Workspace layouts and focus
ports:
  ts:
    description: Tmuxp workspace layouts and focus and current TypeScript builder compatibility.
  rs:
    description: Tmuxp workspace layouts and focus and current Rust builder compatibility.
  go:
    description: Tmuxp workspace layouts and focus and current Go builder compatibility.
  java:
    description: Tmuxp workspace layouts and focus and current Java builder compatibility.
  dotnet:
    description: Tmuxp workspace layouts and focus and current .NET builder compatibility.
  cxx:
    description: Tmuxp workspace layouts and focus and current C++ builder compatibility.
  swift:
    description: Tmuxp workspace layouts and focus and current Swift builder compatibility.
---

<!-- port:py -->This page documents Python tmuxp configuration at the pinned reference revision.
Use tmuxp for the command examples below.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.
<!-- /port -->
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

<!-- port:ts -->## Current TypeScript builder
<!-- /port --><!-- port:rs -->## Current Rust builder
<!-- /port --><!-- port:go -->## Current Go builder
<!-- /port --><!-- port:java -->## Native Java CLI
<!-- /port --><!-- port:dotnet -->## Current .NET builder
<!-- /port --><!-- port:cxx -->## Current C++ builder
<!-- /port --><!-- port:swift -->## Current Swift builder
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->
<!-- /port --><!-- port:ts -->Apply handles supported layouts/focus/options, but planWorkspace describes
topology changes only. It does not enumerate command, option, layout, or focus
changes.
<!-- /port --><!-- port:rs -->Layout and focus are part of the native build plan. Explicit and default
initial-window indexes need compatibility work; use a fresh tmux inspection
rather than the parsed model to check them.
<!-- /port --><!-- port:go -->The parser validates layouts, and the builder applies them through tmux. Global
options are set after initial session creation, so options that affect that
first window can differ from later windows.
<!-- /port --><!-- port:java -->The local CLI validates layout syntax, checksum, structure and pane capacity
before scripts or session mutation. Version-sensitive named layouts use the
selected daemon. tmux owns geometry correction and pruning. All panes in a
window are created and its layout is applied before commands are sent; focus
and `options_after` follow command delivery.
<!-- /port --><!-- port:dotnet -->Rejected layouts are reported in `WorkspaceResult.Unsupported` while the
corresponding windows remain available. Other build failures raise an exception
with partial result information.
<!-- /port --><!-- port:cxx -->Window options precede layout application and options_after follows pane
creation. Commands address actual pane IDs. Failures report a window position
and reason without rollback.
<!-- /port --><!-- port:swift -->Layout descriptions are passed through the builder. Returned Session values are
snapshots; refresh after construction to inspect all created windows and panes.
Do not infer focus/index support from layout support.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->
<!-- /port --><!-- port:ts,rs,go,dotnet,cxx,swift -->See the [native builder behavior](../../internals/topics/) and [configuration
<!-- /port --><!-- port:ts -->source](https://github.com/libtmux/libtmux-ts/blob/f85b8de551353f746d50eaf36bf0112f4fe5a528/packages/workspace/src/config.ts)
<!-- /port --><!-- port:rs -->source](https://github.com/libtmux/libtmux-rs/blob/4a9afac1d82d9a6a9af16099e7b846e69f0e6388/crates/tmux-workspace/src/config.rs)
<!-- /port --><!-- port:go -->source](https://github.com/libtmux/libtmux-go/blob/bb48780c49652d6b7a17884f19a93c269f04a688/workspace/workspace.go)
<!-- /port --><!-- port:dotnet -->source](https://github.com/libtmux/libtmux-dotnet/blob/b71b9654f41785c93717e454cbf176672b3d634a/src/LibTmux.Workspace/WorkspaceYamlParser.cs)
<!-- /port --><!-- port:cxx -->source](https://github.com/libtmux/libtmux-cxx/blob/c7f1146d2ebd7a8323d9f9814517dc3cdf86b4ee/examples/workspace/src/tmuxp.cpp)
<!-- /port --><!-- port:swift -->source](https://github.com/libtmux/libtmux-swift/blob/94b9e4cc436dda8e18e064179ae7d26e55bbbd73/Sources/TmuxWorkspace/Workspace.swift)
<!-- /port --><!-- port:ts,rs,go,dotnet,cxx,swift -->before using these fields through application code.
<!-- /port --><!-- port:java -->See the [CLI configuration parser](https://github.com/libtmux/libtmux-java/blob/2d7e8028986b99c8e9496dc40b5d1e90fb2368c9/workspace-cli/src/main/java/io/github/libtmux/workspace/cli/WorkspacePlan.java).
Application code using the lower-level workspace library has a separate
[builder API](../../internals/topics/). Its schema is not the CLI configuration
contract.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->
<!-- /port -->## Reference source

[classic.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/classic.py); [main-pane-height.yaml](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/main-pane-height.yaml); [main-pane-height-percentage.yaml](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/main-pane-height-percentage.yaml); [focus-window-and-panes.yaml](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/focus-window-and-panes.yaml); [window-index.yaml](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/window-index.yaml).
