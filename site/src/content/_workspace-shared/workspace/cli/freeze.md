---
title: Capture a workspace
description: Capture a running tmux session as a starting point for a workspace file.
product: workspace
sidebar:
  label: Capture a workspace
  group: "CLI reference"
  order: 11
tableOfContents: true
---

<!-- port:py -->
Capture a running tmux session as a starting workspace file. A capture cannot
recover original scripts, plugin intent, comments or every application state.

## Export a named session

After the [installation walkthrough](../../guides/installation/) creates
`workspace-guide`, choose a new destination:

```console
$ tmuxp freeze \
    -L workspace-guide \
    --workspace-format yaml \
    --save-to captured-workspace.yaml \
    --yes \
    workspace-guide
```

Without a session, format or destination, the command can ask for missing
choices. `--yes` answers yes/no questions; it does not supply every choice.
`--quiet` suppresses explanatory status but can still allow prompts.

An explicit `--save-to` path bypasses the overwrite confirmation used by the
prompted path. Select a new path deliberately. A successful export writes a
file; declining a confirmation can return without saving.

Inspect the captured commands and paths before following [export and
reload](../../guides/export-session/).

[Command source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/freeze.py).
<!-- /port -->

<!-- port:ts,rs,go,java,dotnet,cxx,swift -->
Capture a running tmux session as a starting point for a workspace file. Capture
reads live state. It cannot recover original command arguments, command history,
script definitions or plugin intent.

## Inspect a session

After the [installation walkthrough](../../guides/installation/) creates
`workspace-guide`, request a machine result from its private socket:

```console
$ tmux-workspace freeze \
    -S "$WORKSPACE_TMP/tmux.sock" \
    --json \
    workspace-guide
```

## Save the captured document

Name the destination and format explicitly:

```console
$ tmux-workspace freeze \
    -S "$WORKSPACE_TMP/tmux.sock" \
    --json \
    --workspace-format yaml \
    --save-to captured-workspace.yaml \
    workspace-guide
```

Use a new destination, or pass `--force` to authorize replacement. Review
captured commands and directories before loading the file on another machine.
The saved document encoding is separate from the CLI result format selected by
`--json` or `--ndjson`.

See [export and reload](../../guides/export-session/) for the complete workflow.

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
