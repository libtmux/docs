---
description: Resolve explicit files, project directories and saved workspace names.
product: workspace
sidebar:
  group: Guides
  label: Find saved workspaces
  order: 24
tableOfContents: true
title: Find saved workspaces
---

<!-- port:py -->
Use an explicit YAML or JSON file path when you need an unambiguous input. A
directory resolves its project configuration, and a saved name resolves through
the tmuxp configuration roots.

## Global directories

An existing `TMUXP_CONFIGDIR` takes precedence, followed by the XDG
configuration directory and then the legacy [`~/.tmuxp`](./) directory. A nonexistent
explicit directory does not automatically win discovery. See
[environment](../../configuration/environment/) for the relevant variables.

## Project files

Project discovery walks from the current directory toward its ancestors,
stopping at home or the filesystem root. It selects at most one candidate per
directory, preferring `.tmuxp.yaml`, then [`.tmuxp.yml`](./), then [`.tmuxp.json`](./).
Nearer directories come first. It does not recursively enumerate child projects.

Load the current project's configuration:

```console
$ tmuxp load .
```

The normal command can attach or prompt. Use `-d` when you want detached
execution and select `-L` or `-S` for an isolated server. [ls](../../cli/ls/),
[search](../../cli/search/), and [edit](../../cli/edit/) use the same discovery
concepts with their own result and error behavior.

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
<!-- /port -->

<!-- port:ts,rs,go,java,dotnet,cxx,swift -->
Use an explicit path, such as [`./workspace.yaml`](../installation/#create-the-input), to select one document.
Pass a project directory such as `.` to use its [`.tmuxp.yaml`](#list-available-files), [`.tmuxp.yml`](#list-available-files) or
[`.tmuxp.json`](#list-available-files) configuration. A bare saved name uses the global workspace
directory.

## List available files

```console
$ tmux-workspace ls --json
```

Discovery includes project configurations in the current directory and its
parents, plus saved global workspaces. The first existing global directory
wins, in this order:

1. `TMUXP_CONFIGDIR`.
2. `$XDG_CONFIG_HOME/tmuxp`, with [`~/.config`](#list-available-files) as the XDG default.
3. [`~/.tmuxp`](#list-available-files).

An existing empty directory remains selected. A missing directory does not
override an existing fallback merely because its environment variable is set.

## Search by content

```console
$ tmux-workspace search --json window:editor
```

Use [search](../../cli/search/) for field prefixes and pattern rules. Use
[edit](../../cli/edit/) to open a discovered workspace, or
[load](../../cli/load/) with an explicit path when a name is ambiguous.

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
