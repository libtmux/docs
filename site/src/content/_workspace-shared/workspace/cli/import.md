---
description: Import a workspace from a supported external configuration format. Select one of the two child commands.
product: workspace
sidebar:
  group: CLI reference
  label: tmuxp import
  order: 18
tableOfContents: true
title: tmuxp import
---

<!-- port:py -->This page documents the available Python tmuxp reference. Proposed native
extensions are labeled separately.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.
<!-- /port -->
Import a workspace from a supported external configuration format. Select one of
the two child commands.

## Choose the source format

- [Teamocil](../import-teamocil/) converts a Teamocil workspace.
- [tmuxinator](../import-tmuxinator/) converts a tmuxinator workspace.

The parent command groups importers and has no workspace file argument of its
own. Each child requires a source at the parser boundary, despite
optional-looking help. Conversion is schema translation; it does not make
tmuxinator Ruby or ERB evaluation available in a native YAML reader.

<!-- port:dotnet -->## Native .NET imports
<!-- /port --><!-- port:cxx -->## Native C++ imports
<!-- /port --><!-- port:dotnet,cxx -->
<!-- /port --><!-- port:dotnet -->The local `tmux-workspace import` commands translate YAML or JSON and validate
the result with the native workspace loader before printing or saving it.
Invalid shapes, conflicting non-null aliases and unsupported non-null fields
fail before a destination is written, including when `--force` is present.
Successful translation does not run pane commands or establish that their
applications and directories are available.
<!-- /port --><!-- port:cxx -->The local `tmux-workspace` command previews with `--json` and saves with an
explicit destination. Both source and translated workspace are validated
before a destination is replaced:
<!-- /port --><!-- port:dotnet,cxx -->
<!-- /port --><!-- port:dotnet -->Without `--save-to`, `--json` returns the document and `--ndjson` returns a
result record containing it; neither mode guesses an output filename.
`--save-to` selects a destination, `--workspace-format` selects YAML or JSON,
and `--force` permits replacement. Saving publishes through a temporary file
in the destination directory. See [output](../../reference/output/).
<!-- /port --><!-- port:cxx -->```console
$ tmux-workspace import teamocil \
    --save-to team.json \
    team.yml
```
<!-- /port --><!-- port:dotnet,cxx -->
<!-- /port --><!-- port:dotnet -->A missing session name uses the source filename stem. Relative project roots
use the directory where import runs. Teamocil window roots use that same
directory; tmuxinator window roots use the resolved project root.
<!-- /port --><!-- port:cxx -->Use `--force` to replace an existing destination. A refused import leaves it
intact. Unknown fields, ERB templates, host lifecycle hooks, pane titles and
unsupported synchronization timing are reported explicitly. Imports do not
execute Ruby.
<!-- /port --><!-- port:dotnet,cxx -->
<!-- /port --><!-- port:dotnet -->The [Teamocil](../import-teamocil/#native-net-translation) and
[tmuxinator](../import-tmuxinator/#native-net-translation) sections describe
command grouping, focus, synchronization and unsupported fields. Launcher
lifecycle hooks require an explicit supported workflow; importing them as
pane commands would change where and when they run. The importer does not
evaluate Ruby or ERB.

[Native translation source](https://github.com/libtmux/libtmux-dotnet/blob/4ac82a5b82fd8cf68d31c70a2a3eb43c587cd7c0/src/LibTmux.Workspace.Cli/ImportCommands.cs);
[validation and saving source](https://github.com/libtmux/libtmux-dotnet/blob/4ac82a5b82fd8cf68d31c70a2a3eb43c587cd7c0/src/LibTmux.Workspace.Cli/ReadCommands.cs).
<!-- /port --><!-- port:cxx -->See each importer for supported translations. Command text and paths should
be reviewed before loading the result.
<!-- /port --><!-- port:dotnet,cxx -->
<!-- /port -->## Arguments and flags

The parent accepts `-h` / `--help` and selects a child command.

All commands accept `-h` / `--help`. Root options precede the command; see the
[CLI overview](../). The [output reference](../../reference/output/)
<!-- port:py -->distinguishes current Python flags from proposed all-command JSON and NDJSON.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->distinguishes current Python flags from native all-command JSON and NDJSON.
<!-- /port -->
[Parser and implementation source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/import_config.py).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
