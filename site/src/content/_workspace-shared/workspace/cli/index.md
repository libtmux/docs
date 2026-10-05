---
description: Use `tmux-workspace` to load, inspect and save workspace files.
product: workspace
sidebar:
  group: CLI reference
  label: Workspace command reference
  order: 21
tableOfContents: true
title: Workspace command reference
---

<!-- port:py -->
Use `tmuxp` to load, inspect and save workspace configurations. [Install
tmuxp](../guides/installation/) separately from the core `libtmux` package.

## Choose a task

- [Load](./load/) builds a session from files or saved workspace names.
- [Freeze](./freeze/) exports a running session.
- [Convert](./convert/) changes YAML and JSON representation.
- [Edit](./edit/) opens a workspace in an editor.
- [List](./ls/) and [search](./search/) find saved configurations.
- [Diagnostics](./debug-info/) reports runtime and tmux information.
- [Shell](./shell/) evaluates Python with tmux context.
- [Import](./import/) translates Teamocil or tmuxinator configuration.

## Command options

Root options precede the subcommand:

```console
$ tmuxp --color never ls
```

Short flags belong to their command: `search -S` selects smart-case matching,
while `load -S` selects a socket path. Show the installed command options before
using a flag:

```console
$ tmuxp load --help
```

Machine output is command-specific. Read each command reference for its
supported formats and empty-result behavior.

[Command source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
<!-- /port -->

<!-- port:ts,rs,go,java,csharp,cxx,swift -->
Use `tmux-workspace` to load, inspect and save workspace files. Complete
[installation](../guides/installation/) and put the executable on `PATH` before
using these commands.

## Choose a task

- [Load](./load/) creates a session from a workspace file.
- [Freeze](./freeze/) captures a running session into a document.
- [List](./ls/) and [search](./search/) find saved configurations.
- [Edit](./edit/) opens a configuration in your editor.
- [Convert](./convert/) changes a document between YAML and JSON.
- [Import](./import/) translates Teamocil or tmuxinator configuration.
- [Diagnostics](./debug-info/) reports runtime and tmux information.
- [Completion](./completion/) configures your shell.

Show the options accepted by the installed command:

```console
$ tmux-workspace load --help
```

## Machine output

`--json` requests one JSON result. `--ndjson` requests a stream of records and
takes precedence when both are present. Select detached loading with `-d` when
automating session creation. Check the exit status as well as the result; a
failed load can leave completed tmux operations in place.

The [output reference](../reference/output/) describes the result records, and
[automation](../guides/automation/) covers scripts.

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
