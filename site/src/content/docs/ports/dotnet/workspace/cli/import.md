---
title: "tmuxp import"
description: "Import a workspace from a supported external configuration format. Select one of the two child commands."
port: dotnet
product: workspace
sidebar:
  label: "tmuxp import"
  group: "CLI reference"
  order: 18
tableOfContents: true
---

**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.

Import a workspace from a supported external configuration format. Select one of
the two child commands.

## Choose the source format

- [Teamocil](../import-teamocil/) converts a Teamocil workspace.
- [tmuxinator](../import-tmuxinator/) converts a tmuxinator workspace.

The parent command groups importers and has no workspace file argument of its
own. Each child requires a source at the parser boundary, despite
optional-looking help. Conversion is schema translation; it does not make
tmuxinator Ruby or ERB evaluation available in a native YAML reader.

## Native .NET imports

The local `tmux-workspace import` commands translate YAML or JSON and validate
the result with the native workspace loader before printing or saving it.
Invalid shapes, conflicting non-null aliases and unsupported non-null fields
fail before a destination is written, including when `--force` is present.
Successful translation does not run pane commands or establish that their
applications and directories are available.

Without `--save-to`, `--json` returns the document and `--ndjson` returns a
result record containing it; neither mode guesses an output filename.
`--save-to` selects a destination, `--workspace-format` selects YAML or JSON,
and `--force` permits replacement. Saving publishes through a temporary file
in the destination directory. See [output](../../reference/output/).

A missing session name uses the source filename stem. Relative project roots
use the directory where import runs. Teamocil window roots use that same
directory; tmuxinator window roots use the resolved project root.

The [Teamocil](../import-teamocil/#native-net-translation) and
[tmuxinator](../import-tmuxinator/#native-net-translation) sections describe
command grouping, focus, synchronization and unsupported fields. Launcher
lifecycle hooks require an explicit supported workflow; importing them as
pane commands would change where and when they run. The importer does not
evaluate Ruby or ERB.

[Native translation source](https://github.com/libtmux/libtmux-dotnet/blob/4ac82a5b82fd8cf68d31c70a2a3eb43c587cd7c0/src/LibTmux.Workspace.Cli/ImportCommands.cs);
[validation and saving source](https://github.com/libtmux/libtmux-dotnet/blob/4ac82a5b82fd8cf68d31c70a2a3eb43c587cd7c0/src/LibTmux.Workspace.Cli/ReadCommands.cs).

## Arguments and flags

The parent accepts `-h` / `--help` and selects a child command.

All commands accept `-h` / `--help`. Root options precede the command; see the
[CLI overview](../). The [output reference](../../reference/output/)
distinguishes current Python flags from native all-command JSON and NDJSON.

[Parser and implementation source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/import_config.py).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
