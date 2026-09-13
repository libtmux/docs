---
title: "Workspace command reference"
description: "The tmuxp command tree, root options, and native compatibility scope."
port: rs
product: workspace
sidebar:
  label: "Workspace command reference"
  group: "CLI reference"
  order: 21
tableOfContents: true
---

**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../reference/compatibility/) describes this port's implemented coverage.

The installed Python command is `tmuxp`. Native command names and installation
artifacts are not established by this documentation prototype. The pages below
document the Python reference grammar and identify native extensions.

## Commands

- [load](./load/) builds sessions from files or saved workspace names.
- [freeze](./freeze/) captures a live session to a workspace file.
- [convert](./convert/) changes YAML and JSON representation.
- [edit](./edit/) opens a resolved workspace in an editor.
- [ls](./ls/) lists discovered configurations.
- [search](./search/) searches their names and content.
- [debug-info](./debug-info/) reports runtime and tmux diagnostics.
- [shell](./shell/) evaluates Python with tmux context.
- [import](./import/) selects [Teamocil](./import-teamocil/) or [tmuxinator](./import-tmuxinator/) conversion.

## Root options

`-h` / `--help` shows help; `-V` / `--version` prints the version. `--log-level`
selects `"debug"`, `"info"`, `warning`, `"error"`, or `critical`, with parser default
`warning`. `--color` accepts `auto`, `always`, or `never`, defaulting to `auto`.
Place root flags before the subcommand:

```console
$ tmuxp --color never ls
```

Short flags belong to their command: `search -S` is smart case, while `load -S`
selects a tmux socket path. Similarly, `-f` selects a tmux configuration for
load, a field for search, and an output format for freeze.

## Machine mode and automation

Current Python machine output exists on `ls`, `search`, and `debug-info` as
described by their own flags. The native command tree adds `--json` and
`--ndjson` to every leaf and allows these long options before or after the
command. These additions are not installed Python features.

Read [output and color](../reference/output/), [exit
behavior](../reference/exit-codes/), [completion](./completion/), and
[automation](../guides/automation/) before building a script around a command.

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
