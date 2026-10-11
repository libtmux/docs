---
title: Workspace environment
description: Configure the loader process and the variables available to pane commands.
product: workspace
sidebar:
  group: Configuration
  label: Workspace environment
  order: 35
tableOfContents: true
---

<!-- port:py -->
The environment of the process running tmuxp controls discovery, expansion, and
presentation. A workspace's `"environment"` mapping controls the tmux session or
the environment passed when launching a pane. These are separate settings.

```yaml
session_name: environment-example
environment:
  WORKSPACE_ROLE: shared
windows:
  - window_name: main
    environment:
      WINDOW_ROLE: tools
    panes:
      - echo window environment
      - environment:
          PANE_ROLE: isolated
        shell_command: env
```

The first pane receives the window launch map. The second selects its own pane
map instead of merging it with the window map. It still inherits applicable tmux
session/process environment. A pane map does not mean a completely empty
environment plus that map.

## Expansion before launch

Tmuxp expands tilde and environment-variable expressions in session/window
names, paths, before_script, command strings, environment values, and string
option values. It uses the environment of the process invoking tmuxp. It does
not first populate that process environment from the workspace's environment
mapping.

For example, a command using an already-set process variable can be substituted
before pane creation. Inspect the expanded intent when a variable should instead
be read dynamically by a pane shell. Unknown variables and shell-specific
expressions follow the loader's expansion and the eventual shell's rules, not a
general template language.

## CLI and runtime variables

| Variables | Effect |
| --- | --- |
| `TMUXP_CONFIGDIR`, `XDG_CONFIG_HOME`, `HOME` | Global workspace directory selection and home expansion |
| `TMUXINATOR_CONFIG` | Tmuxinator import source directory |
| `$EDITOR` | Editor executable; reference default is vim |
| `$TMUX`, `$TMUX_PANE` | Current tmux connection and shell object context |
| `TMUXP_PROGRESS` | Value 0 disables animated load progress |
| `TMUXP_PROGRESS_FORMAT` | Default/minimal/window/pane/verbose preset or custom tokens |
| `TMUXP_PROGRESS_LINES` | Script panel lines: default 3, 0 hides, -1 caps to terminal height |
| `TMUXP_DETECT_TERMINAL_SIZE` | Value 1 enables size detection; default 1 |
| `TMUXP_DEFAULT_COLUMNS`, `TMUXP_DEFAULT_ROWS` | Fallback session dimensions |
| `COLUMNS`, `LINES`, `ROWS` | Terminal helper overrides and fallback sizing inputs |
| `NO_COLOR`, `FORCE_COLOR` | Color policy; nonempty values are significant |
| `PYTHONSTARTUP` | Startup file used by supported shell startup behavior |
| `IPYTHON_ARGUMENTS` | Whitespace-split arguments for the IPython backend |
| `PYTHONBREAKPOINT` | Can affect debugger selection in tmuxp shell |
| `SHELL` | Shell diagnostics and readiness fallback |
| `DISABLE_AUTO_TITLE` | Oh My Zsh automatic-title warning |
| `PATH` | Executable lookup and diagnostics |
| `LIBTMUX_TMUX_FORMAT_SEPARATOR` | Python libtmux format collection override |

Explicit progress flags take precedence over their corresponding defaults.
Nonempty NO_COLOR disables color even with always; otherwise explicit
never/always precede FORCE_COLOR and automatic TTY detection. Use supported machine formats when consuming output in a script.

See [directories](../directories/) for existing-directory precedence,
[layouts](../layouts/) for size resolution, and [shell](../../cli/shell/) for
Python-specific environment effects.

## Reference source

[loader.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/loader.py); [finders.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/finders.py); [classic.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/classic.py); [load.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/load.py); [shell.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/shell.py); [shell.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/shell.py); [colors.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/_internal/colors.py); [util.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/util.py).
<!-- /port -->

<!-- port:ts,rs,go,java,csharp,cxx,swift -->
The CLI's process environment controls discovery and optional runtimes.
Configuration `environment` maps provide variables to the workspace's shells.

```yaml title="environment.yaml"
session_name: environment-example
environment:
  DOC_SESSION: session
windows:
  - window_name: shell
    environment:
      DOC_WINDOW: window
    panes:
      - environment:
          DOC_PANE: pane
        shell_command:
          'printf "ENV=%s|%s|%s\n" "$DOC_SESSION" "$DOC_WINDOW" "$DOC_PANE"'
      - shell_command:
          'printf "ENV=%s|%s|%s\n" "$DOC_SESSION" "$DOC_WINDOW" "$DOC_PANE"'
```

A pane map selects its launch environment in place of the window map. Session
variables still apply. Repeat a window variable in the pane map when that pane
needs it too. Avoid putting credentials in example files or diagnostic output.

## Variable expressions

<!-- port:rs -->
Names, directories, options and environment values expand defined variables
from the loader process. Command and launch-shell text keep their expressions
for the pane shell; referenced loader variables are supplied to that pane unless
the document already sets them. Shell quoting therefore remains meaningful.
<!-- /port -->
<!-- port:ts,go,java,csharp,cxx,swift -->
The loader expands defined variables in configuration values before delivery.
An expression can therefore use the invoking process's value before the pane
shell reads it. Use explicit configuration variables and inspect resulting
commands when moving a workspace between environments.
<!-- /port -->

## Loader settings

| Variable | Use |
| --- | --- |
| `TMUXP_CONFIGDIR` | Preferred existing directory for saved workspaces |
| `XDG_CONFIG_HOME` | Base for the `tmuxp` configuration directory |
| `EDITOR` | Editor used by `edit` |
| `TMUX_WORKSPACE_PYTHON` | Optional interpreter for `shell` and supported extensions |
| `NO_COLOR` | Disable terminal color when nonempty |

These are process settings, not workspace YAML keys. Read
[discovery](../../guides/discovery/), [editing](../../cli/edit/) and
[shell inspection](../../cli/shell/) for their task-specific behavior.

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
