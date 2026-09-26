---
description: Tmuxp window configuration, field meanings, defaults, and execution behavior.
product: workspace
sidebar:
  group: Configuration
  label: Windows
  order: 32
tableOfContents: true
title: Window configuration
ports:
  ts:
    description: Tmuxp window configuration and current TypeScript builder compatibility.
  rs:
    description: Tmuxp window configuration and current Rust builder compatibility.
  go:
    description: Tmuxp window configuration and current Go builder compatibility.
  java:
    description: Tmuxp window configuration and current Java builder compatibility.
  dotnet:
    description: Tmuxp window configuration and current .NET builder compatibility.
  cxx:
    description: Tmuxp window configuration and current C++ builder compatibility.
  swift:
    description: Tmuxp window configuration and current Swift builder compatibility.
---

<!-- port:py -->This page documents Python tmuxp configuration at the pinned reference revision.
Use tmuxp for the command examples below.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.
<!-- /port -->
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

<!-- port:ts -->## Current TypeScript builder
<!-- /port --><!-- port:rs -->## Current Rust builder
<!-- /port --><!-- port:go -->## Current Go builder
<!-- /port --><!-- port:java -->## Native Java CLI
<!-- /port --><!-- port:dotnet -->## Current .NET builder
<!-- /port --><!-- port:cxx -->## Current C++ builder
<!-- /port --><!-- port:swift -->## Current Swift builder
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->
<!-- /port --><!-- port:ts -->Names, directories, layout, focus, options, pre-pane commands, and panes are
supported. Native apply matches windows by position, not tmux numeric index, and
can reuse existing windows.
<!-- /port --><!-- port:rs -->Window index, layout, focus, options, environment, and directories have native
fields. The current creation plan has first-window index differences, so
successful parsing does not prove requested indexes materialize.
<!-- /port --><!-- port:go -->Window index, shell, focus, layout, options, options_after, and environment have
native support. Global options are applied after the initial session exists, and
pane/window environment values are written to the session.
<!-- /port --><!-- port:java -->The local CLI accepts window names, explicit indexes, layouts, focus,
directories, launch environments, options, `options_after` and `window_shell`.
Window environment supplies the launch map when a pane has no environment map.
A pane override replaces that map. Native layout preflight precedes scripts;
`options_after` runs after pane command delivery.
<!-- /port --><!-- port:dotnet -->Windows, layouts, focus, scalar options, and panes are supported. A bootstrap
window allows session options to be applied before configured windows. Hooks can
observe that temporary window.
<!-- /port --><!-- port:cxx -->Names, indexes, directories, environment, options, layouts, focus, and
options_after are supported in the subset. Inspect actual creation order and
current tmux state when matching reference semantics.
<!-- /port --><!-- port:swift -->Windows have names, directories, layout, and panes. Indexes, environment,
options, and focus settings from the tmuxp reference are not all represented.
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

[classic.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/classic.py); [loader.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/loader.py); [2-pane-synchronized.yaml](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/2-pane-synchronized.yaml).
