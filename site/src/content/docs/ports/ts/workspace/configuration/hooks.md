---
title: "Workspace hooks and builders"
description: "Tmuxp workspace hooks and builders and current TypeScript builder compatibility."
port: ts
product: workspace
sidebar:
  group: Configuration
  label: "Hooks and builders"
  order: 38
tableOfContents: true
---

**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.

Workspace scripts, plugins, and custom builders extend how Python tmuxp creates
a session. They are execution features, not passive configuration metadata. A
workspace naming Python code needs that code installed or importable in tmuxp's
environment.

## Bootstrap with before_script

```yaml
session_name: bootstrap-example
start_directory: ./
before_script: ./bootstrap.sh
windows:
  - window_name: main
    panes:
      - echo bootstrap completed
```

This complete configuration assumes bootstrap.sh exists and is executable. Tmuxp
resolves the script relative to the workspace file and uses the session
start_directory as the process working directory when supplied. A zero exit
status permits configured-window construction to continue; a failing script
raises an error.

The classic builder has already created the initial session when before_script
runs. It kills that session when the bootstrap process fails. That does not undo
files or other external effects created by the script. Pane shell_command is
different: successful text delivery does not check the command's exit status.

## Python plugins

`"plugins"` is a list of Python class references, conventionally a class in a
package's plugin module. Install that package into the same Python environment
as tmuxp. Plugins can declare tmux, libtmux, and tmuxp version requirements.

The lifecycle includes these distinct hooks:

| Hook | When it applies |
| --- | --- |
| `before_workspace_builder` | Initial session exists, before configured windows |
| `on_window_create` | A window has been created, before its panes finish |
| `after_window_finished` | That window's panes and setup have finished |
| `"before_script"` | Plugin callback after session construction |
| `reattach` | Reattachment to a session that already exists |

The plugin callback named before_script is not the workspace before_script
process. Their timing and execution mechanism differ. Plugin methods can change
live tmux state; choose a plugin only when its behavior is intended for the
workspace.

## Select a workspace builder

The default is the built-in classic builder. `workspace_builder` can name a
registered entry point in the [`tmuxp.workspace_builders`](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/registry.py) group, a
`module:attribute` reference, or a dotted Python path. Custom builders receive
expanded configuration and a libtmux server.

`workspace_builder_paths` lists trusted directories temporarily added to
Python's import path. Tilde and environment variables expand, relative entries
resolve against the workspace file, and entries must exist as directories. Tmuxp
does not use site.addsitedir for these paths. Adding an import path is not
permission to treat arbitrary workspace files as inert data.

A builder implements the synchronous build/session interface and cooperates with
plugin, progress, before-script, script-output, and build-event callbacks. The
configuration alone cannot establish that an arbitrary custom builder honors
those callbacks or the classic builder's behavior.

## Pane readiness

```yaml
session_name: readiness-example
workspace_builder: classic
workspace_builder_options:
  pane_readiness: auto
windows:
  - window_name: main
    panes:
      - echo ready
```

Auto, the default, waits for a prompt when the configured session shell is zsh.
Always requests the wait for default-shell panes; never skips it. Accepted
aliases include true/on/yes/1 for always and false/off/no/0 for never, with
strings normalized for case and surrounding whitespace. Unknown values are
rejected.

Custom pane/window launch commands skip prompt waiting. Readiness checks concern
a shell prompt, not the eventual application's health, and do not acknowledge
that every later command was consumed. Use [commands](../commands/) for explicit
delays and Enter behavior.

## Current TypeScript builder

The local `tmux-workspace load` CLI runs ordinary workspaces without Python.
Explicit `plugins` or `workspace_builder` selections use an interpreter with
tmuxp 1.74.0 installed. `TMUX_WORKSPACE_PYTHON` selects it; the default is
`python3`. Empty plugin lists and blank builder names stay native.

The adapter expands common fields and resolves `workspace_builder_paths`
relative to the workspace file. Explicit custom builders may omit `windows`
and consume their own configuration. Append keeps the authenticated current
session across input files. Python extension append rejects `before_script`;
run that script separately. Native append supports before scripts.

Extension output is streamed and retained within the CLI's capture limit.
Progress shows a workspace label without native pane counters. Results describe
observed changes, which may include concurrent work; the CLI does not claim
ownership or roll back extension effects. See [output](../../reference/output/)
and [compatibility status](../../reference/compatibility/) for the result fields
and cancellation behavior.

The separate `@libtmux/workspace` library's apply policies cover ownership,
pruning and command replay; they do not implement Python hooks.

See the [native builder behavior](../../internals/topics/) and [configuration
source](https://github.com/libtmux/libtmux-ts/blob/f85b8de551353f746d50eaf36bf0112f4fe5a528/packages/workspace/src/config.ts)
before using these fields through application code.

## Reference source

[classic.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/classic.py); [registry.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/registry.py); [protocol.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/protocol.py); [options.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/options.py); [plugins.md](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/docs/topics/plugins.md).
