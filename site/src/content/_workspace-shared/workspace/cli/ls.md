---
description: List the workspace files found in project and global configuration locations.
product: workspace
sidebar:
  group: CLI reference
  label: List saved workspaces
  order: 15
tableOfContents: true
title: List saved workspaces
---

<!-- port:py -->
List discovered project and saved workspace files, with optional grouping and
configuration content.

## List records

```console
$ tmuxp ls --json
```

JSON output is an object with `workspaces` and `global_workspace_dirs`. No
workspaces produces an empty `workspaces` array. `--ndjson` emits one record per
line and zero lines for an empty result; it takes precedence when both output
flags are present.

`--full` includes configuration content. `--tree` groups human output by
directory. [Discovery](../../guides/discovery/) explains the locations searched.

[Command source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/ls.py).
<!-- /port -->

<!-- port:ts,rs,go,java,csharp,cxx,swift -->
List the workspace files found in project and global configuration locations.
Listing does not load sessions or run pane commands.

## List records

```console
$ tmux-workspace ls --json
```

Include each document configuration:

```console
$ tmux-workspace ls --full --json
```

For a human display grouped by directory, use `--tree`:

```console
$ tmux-workspace ls --tree
```

Machine output preserves record values and has its own structure; do not parse
the human tree. See [discovery](../../guides/discovery/) for the locations
searched and [output](../../reference/output/) for the result format.

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
