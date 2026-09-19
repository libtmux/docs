---
description: Open a Python shell with tmux objects available, or evaluate Python using `-c`. This command remains Python-specific even when reached through a native command.
product: workspace
sidebar:
  group: CLI reference
  label: tmuxp shell
  order: 17
tableOfContents: true
title: tmuxp shell
ports:
  py:
    description: Open a Python shell with tmux objects available, or evaluate Python using `-c`. This command remains Python-specific even when reached through a future native command.
---

<!-- port:py -->This page documents the available Python tmuxp reference. Proposed native
extensions are labeled separately.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.
<!-- /port -->
Open a Python shell with tmux objects available, or evaluate Python using `-c`.
<!-- port:py -->This command remains Python-specific even when reached through a future native
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->This command remains Python-specific even when reached through a native
<!-- /port -->command.
<!-- port:cxx,swift -->
<!-- /port --><!-- port:cxx -->## Native execution

The development C++ CLI invokes an installed tmuxp 1.74.0 console executable.
Put it on `PATH`, or set `TMUX_WORKSPACE_TMUXP` to its executable path. That
value accepts a single path, including spaces, without interpreter arguments.
Optional backends belong in the selected executable's Python environment.
<!-- /port --><!-- port:swift -->## Evaluate with a selected server
<!-- /port --><!-- port:cxx,swift -->
Continue the [installation walkthrough](../../guides/installation/) through
its detached load, leaving `workspace-guide` running in the same shell:

```console
<!-- /port --><!-- port:cxx -->$ build/cxx-dev/apps/workspace/tmux-workspace shell \
    -S "$WORKSPACE_TMP/tmux.sock" \
    -c 'print(pane.pane_id)' \
    --json \
    workspace-guide editor
```

JSON captures runtime stdout, stderr and status under `"script_output"`.
NDJSON emits flushed `script-output` records with `"stream"` and `"text"`,
then a completed or failed result. Capture is limited to 1 MiB per stream;
overflow stops the child group and reports `OUTPUT_LIMIT` with bounded output.
Human output streams to its original destinations. The runtime's own messages
remain part of its output.

Machine calls require `-c`, including an empty code string. Interactive human
calls require a foreground controlling terminal; exit restores its settings
and foreground group. SIGINT and SIGTERM sent to the workspace process cancel
its owned child group. `-S` takes precedence over `-L`, and opposing startup
flags keep their original order. See the
[native shell contract](https://github.com/libtmux/libtmux-cxx/blob/3963cd7792a72b2b500b8ed4ba08016a791c0d41/apps/workspace/README.md#optional-tmuxp-shell).
<!-- /port --><!-- port:py,ts,rs,go,java,dotnet,cxx -->
## Evaluate with a selected server

<!-- /port --><!-- port:py,cxx -->After the [installation walkthrough](../../guides/installation/) starts its
dedicated server:
<!-- /port --><!-- port:ts,rs,go,java,dotnet -->Continue the [installation walkthrough](../../guides/installation/) through
its detached load, leaving `workspace-guide` running in the same shell:
<!-- /port --><!-- port:py,ts,rs,go,java,dotnet,cxx -->
```console
<!-- /port -->$ tmuxp shell \
<!-- port:py -->    -L workspace-guide \
    -c 'print(server.sessions)'
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->    -S "$WORKSPACE_TMP/tmux.sock" \
    -c 'print(server.sessions)' \
    workspace-guide editor
<!-- /port -->```

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
<!-- port:py -->PTPython. The compatibility proposal uses an optional version-checked Python
bridge and reports an unsupported-runtime error if it is absent. Interactive
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->PTPython. Native ports that support this command use an optional version-checked
Python bridge and report an unsupported-runtime error if it is absent. Check
<!-- /port --><!-- port:ts,rs,go,java,dotnet,swift -->[port coverage](../../reference/compatibility/) before relying on that bridge. Interactive
<!-- /port --><!-- port:py,ts,rs,go,java,dotnet,swift -->machine output needs a separate terminal; an interactive transcript cannot share
JSON stdout.
<!-- /port --><!-- port:cxx -->[port coverage](../../reference/compatibility/) before relying on that bridge.
The C++ command requires `-c` for machine output.
<!-- /port -->
Backend selectors are mutually exclusive.
<!-- port:swift -->
## Native Swift shell

The Swift command uses `TMUX_WORKSPACE_PYTHON` (default `python3`) and checks
for tmuxp 1.74.0 plus libtmux `Server` support for selecting `tmux_bin` before
evaluation. It passes the selected native tmux executable and socket to that
runtime. Run the example above with `tmux-workspace` after installing this
compatible Python environment.

Captured `-c` calls stream output while Python runs. Machine calls require
`-c`; live chunks use structured stderr warnings and the final stdout result
contains both captured streams and the child exit status. See the
[child output contract](../../reference/output/#native-swift-child-output)
for filtering, UTF-8 handling and the one MiB limit per stream. Interactive
backends require a terminal; optional backend packages need broader verification.
<!-- /port -->
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
<!-- port:py -->distinguishes current Python flags from proposed all-command JSON and NDJSON.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->distinguishes current Python flags from native all-command JSON and NDJSON.
<!-- /port -->
[Parser and implementation source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/shell.py).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
