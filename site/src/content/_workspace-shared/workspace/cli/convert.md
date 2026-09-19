---
description: Convert a workspace document between YAML and JSON while retaining its mapping keys. Conversion does not prove that a native builder supports every retained field.
product: workspace
sidebar:
  group: CLI reference
  label: tmuxp convert
  order: 12
tableOfContents: true
title: tmuxp convert
---

<!-- port:py -->This page documents the available Python tmuxp reference. Proposed native
extensions are labeled separately.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.
<!-- /port -->
Convert a workspace document between YAML and JSON while retaining its mapping
keys. Conversion does not prove that a native builder supports every retained
field.

## Change the file format

Given the [`workspace.yaml`](../../guides/installation/#create-the-input) from the [installation
walkthrough](../../guides/installation/), convert it to [`workspace.json`](./):

```console
$ tmuxp convert \
    --yes \
    workspace.yaml
```

The destination has the same stem and opposite extension. In the reference,
`--yes` permits replacement of an existing destination without an additional
existence check. The original input remains. YAML comments and textual
formatting do not round-trip through JSON.

Conversion uses the complete document mapping. A serializer for a reduced native
workspace struct can silently discard extension keys and is insufficient for
<!-- port:py -->this command. The proposed native machine mode returns a document without
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->this command. The native machine mode returns a document without
<!-- /port -->writing a guessed destination; its extra save and overwrite controls are
described in [output](../../reference/output/).

## Arguments and flags

| Argument or flags | Arity / default | Choices or meaning |
| --- | --- | --- |
| `workspace_file` | required | checks tmuxp and current directory for workspace files. |
| `--yes`, `-y` | flag; False | always answer yes |

All commands accept `-h` / `--help`. Root options precede the command; see the
[CLI overview](../). The [output reference](../../reference/output/)
<!-- port:py -->distinguishes current Python flags from proposed all-command JSON and NDJSON.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->distinguishes current Python flags from native all-command JSON and NDJSON.
<!-- /port -->
[Parser and implementation source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/convert.py).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
