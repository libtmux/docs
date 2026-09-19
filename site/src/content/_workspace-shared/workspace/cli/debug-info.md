---
description: Collect tmuxp, Python, tmux, configuration, and environment diagnostics for troubleshooting.
product: workspace
sidebar:
  group: CLI reference
  label: tmuxp debug-info
  order: 14
tableOfContents: true
title: tmuxp debug-info
---

<!-- port:py -->This page documents the available Python tmuxp reference. Proposed native
extensions are labeled separately.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.
<!-- /port -->
Collect tmuxp, Python, tmux, configuration, and environment diagnostics for
troubleshooting.

## Inspect structured diagnostics

```console
$ tmuxp debug-info --json
```

The command writes one JSON object. Named path fields mask the home directory,
but raw tmux output arrays are preserved. Review diagnostics before sharing them
because names, commands, and raw tmux values may identify your environment.

<!-- port:py -->`--ndjson` is a proposed native extension. The native result should name the
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->`--ndjson` is a native extension. The native result should name the
<!-- /port -->port and runtime and define redaction for raw values. See
[troubleshooting](../../guides/troubleshooting/) and
[output](../../reference/output/).

## Arguments and flags

| Argument or flags | Arity / default | Choices or meaning |
| --- | --- | --- |
| `--json` | flag; False | output as JSON |

All commands accept `-h` / `--help`. Root options precede the command; see the
[CLI overview](../). The [output reference](../../reference/output/)
<!-- port:py -->distinguishes current Python flags from proposed all-command JSON and NDJSON.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->distinguishes current Python flags from native all-command JSON and NDJSON.
<!-- /port -->
[Parser and implementation source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/debug_info.py).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
