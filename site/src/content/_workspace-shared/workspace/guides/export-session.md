---
description: Capture a running session, inspect the document and load a second copy.
product: workspace
sidebar:
  group: Guides
  label: Export and reload a session
  order: 26
tableOfContents: true
title: Export and reload a session
---

<!-- port:py -->
Use the session created by the [installation walkthrough](../installation/).
Capture it to a new YAML destination:

```console
$ tmuxp freeze \
    -L workspace-guide \
    --workspace-format yaml \
    --save-to captured-workspace.yaml \
    --yes \
    workspace-guide
```

Review the output file. Capture cannot reconstruct original scripts, shell
history, plugin decisions, comments, or every application's state. Compare
window and pane topology, directories, layouts, environment, and options
explicitly.

Replay under a new name on the same dedicated server:

```console
$ tmuxp load \
    -L workspace-guide \
    -d \
    -s workspace-replay \
    captured-workspace.yaml
```

Inspect the replay:

```console
$ tmux -L workspace-guide list-panes -t '=workspace-replay'
```

Remove the replay when finished:

```console
$ tmux -L workspace-guide kill-session -t '=workspace-replay'
```

The [freeze reference](../../cli/freeze/) explains prompts and overwrite
behavior. [convert](../../cli/convert/) changes document representation without
validating whether a workspace can be loaded.

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
<!-- /port -->

<!-- port:ts,rs,go,java,csharp,cxx,swift -->
Capture the session created by the [installation walkthrough](../installation/)
to a new YAML file:

```console
$ tmux-workspace freeze \
    -S "$WORKSPACE_TMP/tmux.sock" \
    --json \
    --workspace-format yaml \
    --save-to workspace-export.yaml \
    workspace-guide
```

Review the saved commands, directories and layout. Capture reads current tmux
state; it cannot recover original arguments, shell history, scripts, comments
or application state. A captured command may need editing before replay.

## Load a second copy

Use a fresh session name on the same private server:

```console
$ tmux-workspace load \
    -S "$WORKSPACE_TMP/tmux.sock" \
    -d \
    -s workspace-replayed \
    --json \
    workspace-export.yaml
```

Inspect the second copy's panes:

```console
$ tmux -S "$WORKSPACE_TMP/tmux.sock" list-panes -t '=workspace-replayed'
```

Remove that copy when finished:

```console
$ tmux -S "$WORKSPACE_TMP/tmux.sock" kill-session -t '=workspace-replayed'
```

[Capture](../../cli/freeze/) explains destination handling.
[Conversion](../../cli/convert/) changes file encoding without proving the
document can be loaded.

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
