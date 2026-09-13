---
title: "tmuxp import teamocil"
description: "Translate a Teamocil workspace into tmuxp configuration, review the result, and select its saved representation."
port: dotnet
product: workspace
sidebar:
  label: "tmuxp import teamocil"
  group: "CLI reference"
  order: 19
tableOfContents: true
---

**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.

Translate a Teamocil workspace into tmuxp configuration, review the result, and
select its saved representation.

## Select an existing source

With [`project.yml`](../../guides/discovery/) already present in the Teamocil configuration directory:

```console
$ tmuxp import teamocil project
```

The source lookup uses [`~/.teamocil`](./). A source argument is effectively required:
although its positional action has optional arity, it belongs to a required
exclusive group, and omission exits 2. The reference previews and saves the
transformed document interactively.

Native automation needs explicit destination, encoding, and overwrite policy
instead of implicit prompts. See [output](../../reference/output/). Inspect
translated commands and directories before loading the result.

An extensionless name searches the configured source directory. A filename
with an extension is resolved relative to the current directory unless you
provide an explicit path.

## Native .NET translation

`tmux-workspace import teamocil` accepts a session mapping, including the
`session` wrapper. It preserves names, roots, layouts, window options and
the first true window/pane focus flag in each scope.

Each `panes` item creates one pane. A pane command string or `commands` list
becomes one shell input; list entries join with `; ` to retain their command
group. The aliases `tabs`, `splits` and `cmd` are accepted for `windows`,
`panes` and `commands`. Null aliases fall back to the other spelling;
conflicting non-null values fail validation.

Window options apply before command delivery, including `synchronize-panes`.
Synchronized commands can therefore also reach panes created earlier in the
same window. Filters, `clear` and unsupported pane-width fields are refused
instead of being discarded. See [native import saving](../import/#native-net-imports)
for roots, output and validation behavior.

## Arguments and flags

| Argument or flags | Arity / default | Choices or meaning |
| --- | --- | --- |
| `workspace_file` | effectively required | `nargs="?"` belongs to a required exclusive group; omission exits 2. Source lookup uses [`~/.teamocil`](./). |

All commands accept `-h` / `--help`. Root options precede the command; see the
[CLI overview](../). The [output reference](../../reference/output/)
distinguishes current Python flags from native all-command JSON and NDJSON.

[Parser and implementation source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/import_config.py).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
