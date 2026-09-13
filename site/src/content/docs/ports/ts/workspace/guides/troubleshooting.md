---
title: "Troubleshoot workspace loading"
description: "Diagnose argument, discovery, configuration, shell, and partial-build failures."
port: ts
product: workspace
sidebar:
  label: "Troubleshoot workspace loading"
  group: "Guides"
  order: 27
tableOfContents: true
---

**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.

Start by identifying the failing stage. A parser error happens before a
workspace is loaded. A missing file is a discovery problem. An accepted document
can still fail during tmux creation, shell startup, command dispatch, or a
plugin callback.

## Arguments and files

Use the [command reference](../../cli/) for local flag meanings. Place root
`--color` and `--log-level` before the command. Keep multiple load filenames
together. Both importer children require a source argument. Confirm an explicit
file works before investigating saved-name discovery.

## Configuration and commands

Check the [configuration reference](../../configuration/) and the [example
gallery](../../examples/gallery/). YAML parsing alone does not validate keys or
prove builder support. A missing shell executable, directory, plugin package,
SSH target, or application can prevent an otherwise valid workspace from
behaving as intended.

Commands are sent into panes and can require shell readiness. `enter: false`
intentionally leaves text unsubmitted. Delays are measured in seconds; explicit
zero and omission differ. See [commands](../../configuration/commands/) and
[hooks](../../configuration/hooks/).

## Diagnostics and remaining state

```console
$ tmuxp debug-info --json
```

Inspect raw tmux values before sharing diagnostics. Use the same `-L` or `-S`
endpoint when inspecting a failed load. A partial build can leave sessions,
windows, and panes behind; inspect them before cleanup. Do not assume rollback
or kill an unrelated default server.

Native failures must be evaluated against [port
compatibility](../../reference/compatibility/), not inferred from a Python
example. The native machine contract reports completed and failed stages
explicitly.

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
