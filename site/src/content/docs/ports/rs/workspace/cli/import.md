---
title: "tmuxp import"
description: "Import a workspace from a supported external configuration format. Select one of the two child commands."
port: rs
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

## Arguments and flags

The parent accepts `-h` / `--help` and selects a child command.

All commands accept `-h` / `--help`. Root options precede the command; see the
[CLI overview](../). The [output reference](../../reference/output/)
distinguishes current Python flags from native all-command JSON and NDJSON.

[Parser and implementation source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/import_config.py).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
