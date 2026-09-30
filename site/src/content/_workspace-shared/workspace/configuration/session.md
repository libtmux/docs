---
description: Name a workspace and apply session options and environment.
product: workspace
sidebar:
  group: Configuration
  label: Session configuration
  order: 31
tableOfContents: true
title: Session configuration
---

<!-- port:py -->
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

## Reference source

[classic.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/classic.py); [loader.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/loader.py); [load.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/load.py).
<!-- /port -->

<!-- port:ts,rs,go,java,dotnet,cxx,swift -->
Set `session_name` and an ordered, nonempty `windows` list. Use a simple name
without tmux target separators such as `:` and `.`.

```yaml title="session.yaml"
session_name: session-example
environment:
  PROJECT_MODE: development
options:
  status: false
windows:
  - window_name: shell
    panes: [null]
```

## Session fields

| Field | Effect |
| --- | --- |
| `session_name` | Session to create or reuse |
| `windows` | Windows to construct in order |
| `start_directory` | Starting directory inherited by child configuration |
| `environment` | Variables supplied to the workspace |
| `options` | Options applied to this session |
| `global_options` | Options applied globally on the selected tmux server |
| `shell_command_before` | Commands prepended to each pane's commands |
| `suppress_history` | History policy inherited by windows and panes |
| `before_script` | Checked bootstrap process |
| `workspace_builder_options` | Builder settings such as prompt readiness |

Use `global_options` only when every session on that server should share the
change. Select a private socket for examples and automated jobs.

An existing session is reused under the loader's policy. Use `load -s NAME`
when a second copy needs another name. Loading does not remove unrelated
sessions or reconcile away extra windows.

Read [environment](../environment/), [commands](../commands/) and
[hooks](../hooks/) for the behavior behind those fields.

<!-- port:ts -->
[CLI source](https://github.com/libtmux/libtmux-ts/blob/f36d692552bb9a373b45338bb5fece854e57cc3d/packages/workspace-cli/README.md).
<!-- /port -->
<!-- port:rs -->
[CLI source](https://github.com/libtmux/libtmux-rs/blob/e9be0b6f6d22cd2eb79b0ec08964f82e717e5fe4/crates/tmux-workspace/docs/cli.md).
<!-- /port -->
<!-- port:go -->
[CLI source](https://github.com/libtmux/libtmux-go/blob/bb06e26e116e941813ca40bf45e7e3a47d38f52a/workspace/CLI.md).
<!-- /port -->
<!-- port:java -->
[CLI source](https://github.com/libtmux/libtmux-java/blob/3e5b20d22af3890ae5f7f52842e4b05d170a983f/libtmux-workspace-cli/README.md).
<!-- /port -->
<!-- port:dotnet -->
[CLI source](https://github.com/libtmux/libtmux-dotnet/blob/f77fe776ba67a04abb20ddbbc26cf4a000d63b74/src/LibTmux.Workspace.Cli/README.md).
<!-- /port -->
<!-- port:cxx -->
[CLI source](https://github.com/libtmux/libtmux-cxx/blob/9c8c6a264114277df84c9f6819855093adae5c6e/apps/workspace/README.md).
<!-- /port -->
<!-- port:swift -->
[CLI source](https://github.com/libtmux/libtmux-swift/blob/53c67947879f4976ddf2c43f3c8df7c7671c5b19/Sources/TmuxWorkspaceCLI/README.md).
<!-- /port -->
<!-- /port -->
