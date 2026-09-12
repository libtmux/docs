---
title: "tmuxp import tmuxinator"
description: "Translate a tmuxinator workspace into tmuxp configuration, preserving an explicit boundary around dynamic Ruby configuration."
port: rs
product: workspace
sidebar:
  label: "tmuxp import tmuxinator"
  group: "CLI reference"
  order: 20
tableOfContents: true
---

**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.

Translate a tmuxinator workspace into tmuxp configuration, preserving an
explicit boundary around dynamic Ruby configuration.

## Select an existing source

With [`project.yml`](../../guides/discovery/) already present in the configured tmuxinator directory:

```console
$ tmuxp import tmuxinator project
```

`TMUXINATOR_CONFIG` overrides the source directory and expands a leading tilde.
A source argument is effectively required, and omission exits 2 despite
optional-looking help. The reference previews and saves the transformed document
interactively.

Do not interpret successful YAML parsing as support for ERB templates or
arbitrary Ruby execution. Native importers must either implement a documented
bridge or reject unsupported dynamic input. Inspect the resulting commands and
directories before loading. See [environment](../../configuration/environment/)
and [output](../../reference/output/).

An extensionless name searches the configured source directory. A filename
with an extension is resolved relative to the current directory unless you
provide an explicit path.

## Arguments and flags

| Argument or flags | Arity / default | Choices or meaning |
| --- | --- | --- |
| `workspace_file` | effectively required | `nargs="?"` belongs to a required exclusive group; omission exits 2. Source lookup honors `TMUXINATOR_CONFIG`. |

All commands accept `-h` / `--help`. Root options precede the command; see the
[CLI overview](../). The [output reference](../../reference/output/)
distinguishes current Python flags from native all-command JSON and NDJSON.

[Parser and implementation source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/import_config.py).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
