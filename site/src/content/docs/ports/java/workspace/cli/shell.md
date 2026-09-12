---
title: "tmuxp shell"
description: "Open a Python shell with tmux objects available, or evaluate Python using `-c`. This command remains Python-specific even when reached through a native command."
port: java
product: workspace
sidebar:
  label: "tmuxp shell"
  group: "CLI reference"
  order: 17
tableOfContents: true
---

**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.

Open a Python shell with tmux objects available, or evaluate Python using `-c`.
This command remains Python-specific even when reached through a native
command.

## Evaluate with a selected server

After the [installation walkthrough](../../guides/installation/) starts its
dedicated server:

```console
$ tmuxp shell \
    -L workspace-guide \
    -c 'print(server.sessions)'
```

Use `-c`; the reference does not define `--command`. Optional session and window
arguments select context. `--best` chooses the best available shell backend; the
explicit selectors require their corresponding Python packages. The `--pdb` path
uses a debugger rather than a normal REPL.

The paired `--use-pythonrc` / `--no-startup` and `--use-vi-mode` /
`--no-vi-mode` options share destinations. The last occurrence wins. The
negative options disable the corresponding setting. See
[environment](../../configuration/environment/) for startup and backend
settings.

A native REPL is not an equivalent implementation of Python `-c`, IPython, or
PTPython. Native ports that support this command use an optional version-checked
Python bridge and report an unsupported-runtime error if it is absent. Check
[port coverage](../../reference/compatibility/) before relying on that bridge. Interactive
machine output needs a separate terminal; an interactive transcript cannot share
JSON stdout.

Backend selectors are mutually exclusive.

## Arguments and flags

| Argument or flags | Arity / default | Choices or meaning |
| --- | --- | --- |
| `"session_name"` | optional |  |
| `"window_name"` | optional |  |
| `-S` | value; None | pass-through for tmux -S |
| `-L` | value; None | pass-through for tmux -L |
| `-c` | value; None | instead of opening shell, execute python code in libtmux and exit |
| `--best` | flag; best | use best shell available in site packages |
| `--pdb` | flag; None | use plain pdb |
| `--code` | flag; None | use stdlib's code.interact() |
| `--ptipython` | flag; None | use ptpython + ipython |
| `--ptpython` | flag; None | use ptpython |
| `--ipython` | flag; None | use ipython |
| `--bpython` | flag; None | use bpython |
| `--use-pythonrc` | flag; False | load PYTHONSTARTUP env var and ~/.pythonrc.py script in --code |
| `--no-startup` | flag; False | disable Python startup loading; shares a destination with `--use-pythonrc`, last occurrence wins |
| `--use-vi-mode` | flag; False | use vi-mode in ptpython/ptipython |
| `--no-vi-mode` | flag; False | disable vi mode; shares a destination with `--use-vi-mode`, last occurrence wins |

All commands accept `-h` / `--help`. Root options precede the command; see the
[CLI overview](../). The [output reference](../../reference/output/)
distinguishes current Python flags from native all-command JSON and NDJSON.

[Parser and implementation source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/shell.py).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
