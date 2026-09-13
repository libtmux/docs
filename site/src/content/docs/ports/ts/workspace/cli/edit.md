---
title: "tmuxp edit"
description: "Resolve a saved workspace or file and open it in the configured editor. The lookup rules are shared with loading."
port: ts
product: workspace
sidebar:
  label: "tmuxp edit"
  group: "CLI reference"
  order: 13
tableOfContents: true
---

**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.

Resolve a saved workspace or file and open it in the configured editor. The
lookup rules are shared with loading.

## Open a workspace

With [`workspace.yaml`](../../guides/installation/#create-the-input) already saved and `$EDITOR` set to a single executable:

```console
$ tmuxp edit workspace.yaml
```

The reference passes the entire `$EDITOR` value as one executable string followed
by the file path. An editor command containing arguments is not tokenized. It
waits for the child process but does not propagate that child's exit status. Use
an editor wrapper executable when arguments are needed.

The native contract defines argument parsing and propagates child
failure. These are deliberate behavior changes, not existing Python guarantees.
See [discovery](../../guides/discovery/) and
[environment](../../configuration/environment/).

## Arguments and flags

| Argument or flags | Arity / default | Choices or meaning |
| --- | --- | --- |
| `workspace_file` | required | checks current tmuxp and current directory for workspace files. |

All commands accept `-h` / `--help`. Root options precede the command; see the
[CLI overview](../). The [output reference](../../reference/output/)
distinguishes current Python flags from native all-command JSON and NDJSON.

[Parser and implementation source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/edit.py).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
