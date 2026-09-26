---
description: Resolve a saved workspace or file and open it in the configured editor. The lookup rules are shared with loading.
product: workspace
sidebar:
  group: CLI reference
  label: tmuxp edit
  order: 13
tableOfContents: true
title: tmuxp edit
---

<!-- port:py -->This page documents the available Python tmuxp reference. Proposed native
extensions are labeled separately.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.
<!-- /port -->
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

<!-- port:py -->The proposed native contract defines argument parsing and propagates child
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->The native contract defines argument parsing and propagates child
<!-- /port -->failure. These are deliberate behavior changes, not existing Python guarantees.
See [discovery](../../guides/discovery/) and
[environment](../../configuration/environment/).

## Arguments and flags

| Argument or flags | Arity / default | Choices or meaning |
| --- | --- | --- |
| `workspace_file` | required | checks current tmuxp and current directory for workspace files. |

All commands accept `-h` / `--help`. Root options precede the command; see the
[CLI overview](../). The [output reference](../../reference/output/)
<!-- port:py -->distinguishes current Python flags from proposed all-command JSON and NDJSON.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->distinguishes current Python flags from native all-command JSON and NDJSON.
<!-- /port -->
[Parser and implementation source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/edit.py).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
