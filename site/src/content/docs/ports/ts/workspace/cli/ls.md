---
title: "tmuxp ls"
description: "List discovered project and saved workspace files, with optional grouping and configuration content."
port: ts
product: workspace
sidebar:
  label: "tmuxp ls"
  group: "CLI reference"
  order: 15
tableOfContents: true
---

**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.

List discovered project and saved workspace files, with optional grouping and
configuration content.

## List workspace records

```console
$ tmuxp ls --json
```

JSON output is an object with `workspaces` and `global_workspace_dirs`; no
workspaces still produces the object with an empty array. `--ndjson` emits one
workspace record per line and emits zero lines for no records. When both format
flags are supplied, NDJSON wins. `--full` includes full configuration content.
`--tree` groups the human display by directory.

Discovery includes nearest project configurations and configured global
directories. It is not a recursive scan of every descendant directory. See
[discovery rules](../../guides/discovery/) for precedence and candidate names.

## Arguments and flags

| Argument or flags | Arity / default | Choices or meaning |
| --- | --- | --- |
| `--tree` | flag; False | display workspaces grouped by directory |
| `--json` | flag; False | output as JSON |
| `--ndjson` | flag; False | output as NDJSON (one JSON per line) |
| `--full` | flag; False | include full config content in output |

All commands accept `-h` / `--help`. Root options precede the command; see the
[CLI overview](../). The [output reference](../../reference/output/)
distinguishes current Python flags from native all-command JSON and NDJSON.

[Parser and implementation source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/ls.py).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
