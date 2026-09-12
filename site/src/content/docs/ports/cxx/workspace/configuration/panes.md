---
title: "Pane configuration"
description: "Tmuxp pane configuration and current C++ builder compatibility."
port: cxx
product: workspace
sidebar:
  group: Configuration
  label: "Panes"
  order: 33
tableOfContents: true
---

**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.

A pane can be a command string, a list of commands, or a mapping of settings.
Each item in the window's `"panes"` list creates one pane; a command list inside
that item describes several commands in that same pane.

```yaml
session_name: pane-example
start_directory: ./
windows:
  - window_name: main
    start_directory: ./
    panes:
      - echo one command
      - [echo first command, echo second command]
      - shell_command:
          - echo configured pane
        start_directory: ./
        focus: true
      - blank
```

## Blank forms

| Form inside `"panes"` | Reference interpretation |
| --- | --- |
| null, omitted YAML value, `blank`, or `"pane"` | Pane without its own commands |
| Empty mapping or empty list | Expands to a pane without its own commands |
| Mapping with no shell_command | Keeps the pane's other settings and uses no own commands |
| `shell_command: null` or a single null command | No own commands |
| Empty string `""` | Sends an empty command, normally pressing Enter |

A blank pane can still receive inherited [before commands](../commands/). Blank
forms do not disable session/window/pane setup. An omitted window panes key is
defaulted to one blank pane; an explicitly empty panes list is a different shape
and should not be used as a portable way to request that default.

## Pane keys

| Key | Meaning |
| --- | --- |
| `shell_command` | String, ordered command list, or supported command dictionaries |
| `shell_command_before` | Setup prepended after session/window before commands |
| `start_directory` | Pane directory override |
| `"shell"` | Shell/application launched for this pane |
| `focus` | Select this pane in its window |
| `"environment"` | Environment map selected for this pane's launch |
| `"suppress_history"` | Pane history policy override |
| `"enter"` | Default for whether to submit each command |
| `sleep_before`, `sleep_after` | Default delays in seconds around each command |

## Launch a shell or type commands

`"shell"` chooses the process tmux starts in the pane. `shell_command` sends text
into the process already running there. Launching an application through shell
can work with tmux's remain-on-exit behavior, while typing that application's
name into a shell has different process semantics.

A pane shell overrides window_shell, including on the first pane. The first pane
also supplies its directory and environment during window creation. Use an
installed shell/application path rather than assuming the same executable exists
on every host.

A successful build confirms command delivery, not application readiness or
command exit status. See [commands](../commands/) for Enter, timing, and
history, and [environment](../environment/) for launch-map selection.

## Current C++ builder

Native pane commands support Enter, pause, and history metadata. Exact shorthand
and shell/environment combinations still need the parser and execution behavior
checked separately.

See the [native builder behavior](../../internals/topics/) and [configuration
source](https://github.com/libtmux/libtmux-cxx/blob/c7f1146d2ebd7a8323d9f9814517dc3cdf86b4ee/examples/workspace/src/tmuxp.cpp)
before using these fields through application code.

## Reference source

[loader.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/loader.py); [classic.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/classic.py); [blank-panes.yaml](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/blank-panes.yaml); [pane-shell.yaml](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/pane-shell.yaml).
