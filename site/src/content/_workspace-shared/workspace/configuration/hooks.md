---
description: Run a checked bootstrap process before workspace commands.
product: workspace
sidebar:
  group: Configuration
  label: Bootstrap scripts and extensions
  order: 38
tableOfContents: true
title: Bootstrap scripts and extensions
---

<!-- port:py -->
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

## Reference source

[classic.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/classic.py); [registry.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/registry.py); [protocol.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/protocol.py); [options.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/options.py); [plugins.md](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/docs/topics/plugins.md).
<!-- /port -->

<!-- port:ts,rs,go,java,csharp,cxx,swift -->
Use `before_script` when setup must finish successfully before configured
windows are built. The command is split into an executable and arguments;
shell operators require an explicit shell.

```yaml title="hooks.yaml"
session_name: hooks-example
before_script: /bin/sh -c 'printf bootstrap-ready'
windows:
  - window_name: shell
    panes: [null]
```

The CLI checks the child process status. A failure stops that workspace's
build. The result describes retained effects; an earlier input or borrowed
session can still exist. A pane's `shell_command` only sends input and does
not provide this process-status guarantee.

## Paths and output

A relative script path beginning with `.` is resolved from the workspace file.
The script's working directory uses the configured session directory when
present, otherwise the invocation directory. The script runs before workspace
pane commands. Reusing an existing session does not replay its bootstrap.

Machine output captures or streams child output through the CLI protocol.
Read [output](../../reference/output/) before parsing bootstrap records.

## Prompt readiness

The `pane_readiness` setting under `workspace_builder_options` accepts `auto`,
`always` or `never`.
It controls a bounded wait before initial pane input. It does not wait for a
server process to accept connections. Commands can still be delivered when
the prompt wait expires.

## Optional extensions

<!-- port:ts,rs,go,java,csharp -->
Nonempty `plugins` or `workspace_builder` values select the optional Python
extension runtime. Set `TMUX_WORKSPACE_PYTHON` to an interpreter with a compatible
tmuxp 1.74 installation. Ordinary documents use the native builder.

Extensions run executable code and can make changes outside the CLI's own
tracked operations. Inspect reported effects and errors before retrying them.
<!-- /port -->
<!-- port:cxx,swift -->
Plugin and custom-builder execution is unsupported. The CLI refuses those
execution fields instead of treating them as successful native work. The
optional [inspection shell](../../cli/shell/) is a separate feature.
<!-- /port -->

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
<!-- port:csharp -->
[CLI source](https://github.com/libtmux/libtmux-dotnet/blob/f77fe776ba67a04abb20ddbbc26cf4a000d63b74/src/LibTmux.Workspace.Cli/README.md).
<!-- /port -->
<!-- port:cxx -->
[CLI source](https://github.com/libtmux/libtmux-cxx/blob/9c8c6a264114277df84c9f6819855093adae5c6e/apps/workspace/README.md).
<!-- /port -->
<!-- port:swift -->
[CLI source](https://github.com/libtmux/libtmux-swift/blob/53c67947879f4976ddf2c43f3c8df7c7671c5b19/Sources/TmuxWorkspaceCLI/README.md).
<!-- /port -->
<!-- /port -->
