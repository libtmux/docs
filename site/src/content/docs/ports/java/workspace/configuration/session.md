---
title: "Session configuration"
description: "Tmuxp session configuration and current Java builder compatibility."
port: java
product: workspace
sidebar:
  group: Configuration
  label: "Session"
  order: 31
tableOfContents: true
---

**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.

The root mapping names the session and supplies defaults inherited by its
windows and panes. The file's name is independent of `"session_name"`: loading
[`project.yaml`](../../guides/discovery/) can create a session named `development`.

```yaml
session_name: development
start_directory: ./
suppress_history: true
shell_command_before:
  - echo preparing pane
environment:
  WORKSPACE_ROLE: development
options:
  default-shell: /bin/sh
global_options:
  status: true
windows:
  - window_name: main
    panes:
      - echo ready
```

`"global_options"` changes the shared tmux server. Use a dedicated socket while
learning these options. The example assumes `/bin/sh` exists.

## Root keys

| Key | Meaning |
| --- | --- |
| `"session_name"` | Session identity; expanded before building |
| `"windows"` | Ordered list of window mappings |
| `start_directory` | Starting directory and base for inherited window directories |
| `"options"` | tmux session options applied during construction |
| `"global_options"` | tmux options applied with global scope on the selected server |
| `"environment"` | Values placed in the tmux session environment |
| `shell_command_before` | Commands prepended to commands in every pane |
| `"suppress_history"` | Default history suppression inherited by windows and panes |
| `"before_script"` | Process run after initial session creation, before configured windows |
| `"plugins"` | List of Python plugin class references |
| `workspace_builder` | Classic builder, registered builder name, or Python class reference |
| `workspace_builder_paths` | Trusted directories used for Python builder imports |
| `workspace_builder_options` | Builder behavior settings such as pane_readiness |

Options use tmux option names and values. A workspace key such as
`start_directory` is not a tmux option and does not belong in `"options"`. Some
tmux settings are window options even when tmux permits them through a session
target; consult tmux's option scope when choosing the catalog.

## Construction order

The classic builder creates the initial session, runs its initial plugin hook
and workspace before_script, then applies root options, global options, and
session environment before creating configured windows. The temporary initial
window is replaced. Hooks can observe those tmux operations; loading is not an
invisible transaction.

The same-named session is handled by the [load command](../../cli/load/) and its
attach, switch, append, and detached choices. Changing a YAML file does not
automatically reconcile an existing running session. An explicit `load -s` value
overrides the configured name for that invocation.

## Inherited defaults

A window can override its start directory and history policy, and a pane can
override them again. Before commands accumulate in session, window, then pane
order. Session environment remains distinct from window/pane launch
environments. Read [directories](../directories/), [commands](../commands/), and
[environment](../environment/) before relying on inheritance.

Python scripts, plugins, and custom builder references execute code. Their exact
timing and runtime requirements are in [hooks and builders](../hooks/).

## Current Java builder

Root fields are session_name and windows. Session directories, environment,
options, before_script, plugins, and custom builder selection are rejected.

See the [native builder behavior](../../internals/topics/) and [configuration
source](https://github.com/libtmux/libtmux-java/blob/4f057d367a25dee818d70876fa283fc503a3a7eb/libtmux-workspace/src/main/java/io/github/libtmux/workspace/WorkspaceParser.java)
before using these fields through application code.

## Reference source

[classic.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/classic.py); [loader.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/loader.py); [load.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/load.py).
