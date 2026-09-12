---
title: "Workspace environment"
description: "Tmuxp workspace environment and current Rust builder compatibility."
port: rs
product: workspace
sidebar:
  group: Configuration
  label: "Environment"
  order: 35
tableOfContents: true
---

**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.

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
never/always precede FORCE_COLOR and automatic TTY detection. Machine-output
extensions must disable ANSI regardless of forced color.

`CLICOLOR` and `CLICOLOR_FORCE` are proposed cross-port presentation extensions,
not variables read by this tmuxp reference. Native format codecs also need
separate evidence before claiming the Python separator override works.

See [directories](../directories/) for existing-directory precedence,
[layouts](../layouts/) for size resolution, and [shell](../../cli/shell/) for
Python-specific environment effects.

## Current Rust builder

Environment maps are present in the model. Variable interpolation and tmuxp
pane/window environment selection are separate execution requirements and must
not be inferred from those fields.

See the [native builder behavior](../../internals/topics/) and [configuration
source](https://github.com/libtmux/libtmux-rs/blob/4a9afac1d82d9a6a9af16099e7b846e69f0e6388/crates/tmux-workspace/src/config.rs)
before using these fields through application code.

## Reference source

[loader.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/loader.py); [finders.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/finders.py); [classic.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/classic.py); [load.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/load.py); [shell.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/shell.py); [shell.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/shell.py); [colors.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/_internal/colors.py); [util.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/util.py).
