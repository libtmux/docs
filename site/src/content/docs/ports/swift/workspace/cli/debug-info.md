---
title: "tmuxp debug-info"
description: "Collect tmuxp, Python, tmux, configuration, and environment diagnostics for troubleshooting."
port: swift
product: workspace
sidebar:
  label: "tmuxp debug-info"
  group: "CLI reference"
  order: 14
tableOfContents: true
---

**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.

Collect tmuxp, Python, tmux, configuration, and environment diagnostics for
troubleshooting.

## Inspect structured diagnostics

```console
$ tmuxp debug-info --json
```

The command writes one JSON object. Named path fields mask the home directory,
but raw tmux output arrays are preserved. Review diagnostics before sharing them
because names, commands, and raw tmux values may identify your environment.

`--ndjson` is a native extension. The native result should name the
port and runtime and define redaction for raw values. See
[troubleshooting](../../guides/troubleshooting/) and
[output](../../reference/output/).

## Arguments and flags

| Argument or flags | Arity / default | Choices or meaning |
| --- | --- | --- |
| `--json` | flag; False | output as JSON |

All commands accept `-h` / `--help`. Root options precede the command; see the
[CLI overview](../). The [output reference](../../reference/output/)
distinguishes current Python flags from native all-command JSON and NDJSON.

[Parser and implementation source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/debug_info.py).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
