---
title: "Workspace commands"
description: "Tmuxp workspace commands, field meanings, defaults, and execution behavior."
port: py
product: workspace
sidebar:
  group: Configuration
  label: "Commands"
  order: 34
tableOfContents: true
---

This page documents Python tmuxp configuration at the pinned reference revision.
Use tmuxp for the command examples below.

Tmuxp sends workspace commands into panes in order. A command can be a string or
a mapping with `"cmd"` and execution controls. `shell_command_before` adds shared
setup without copying it into every pane.

```yaml
session_name: command-example
shell_command_before:
  - echo session setup
windows:
  - window_name: main
    shell_command_before:
      - echo window setup
    panes:
      - shell_command_before:
          - echo pane setup
        shell_command:
          - cmd: echo ready
            sleep_after: 0.2
          - cmd: echo typed but not submitted
            enter: false
            sleep_after: 0
```

This sends the three setup commands, submits echo ready, waits 0.2 seconds, and
leaves the final command at the prompt. The delay pauses construction; it does
not ask the application whether it is ready.

## Forms and order

`shell_command` and `shell_command_before` accept a scalar command or a list. A
command dictionary requires `"cmd"` for the text. The loader expands shell
variables and tilde expressions in command strings before the builder sends
them. Variables already known to the process running tmuxp can therefore be
substituted before a pane shell sees the command.

For each pane, the loader concatenates session before commands, window before
commands, pane before commands, then the pane's own commands. A blank pane still
receives inherited setup. Quoting affects the pane shell too; YAML quoting alone
does not bypass tmuxp's expansion step.

## Enter and delays

| Setting | Default and scope |
| --- | --- |
| `"enter"` | True; pane default, then command override |
| `sleep_before` | No delay; pane default, then command override in seconds |
| `sleep_after` | No delay; pane default, then command override in seconds |

In the classic builder, a command's enter/delay override carries forward to
subsequent commands in that pane. Set `enter: true` or an explicit zero delay to
restore that behavior for a later command. Absence means keep the current value;
zero is an intentional delay override.

Pauses run synchronously during construction. They can let a startup command
settle but do not monitor its success. A failed pane command is not necessarily
a failed tmux send operation, and starting a web server is not proof it is
accepting connections.

## History and prompt readiness

History suppression defaults to true. A session value trickles to a window, and
a pane can override it. Suppression prefixes command text with a space. Bash
needs HISTCONTROL containing ignorespace or ignoreboth; zsh needs
HIST_IGNORE_SPACE. Without shell support, the command can still enter history.

Builder pane_readiness is separate from command delays. Auto waits for the
configured zsh session shell, while custom pane/window launch commands skip
prompt waiting. See [hooks and builders](../hooks/) for the policy and its
limits.

A workspace [before_script](../hooks/) runs as a process outside the panes and
checks its exit status. Use it for bootstrap work that must succeed before
configured windows are built, rather than treating pane command delivery as a
checked process result.

## Reference source

[loader.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/loader.py); [classic.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/classic.py); [sleep.yaml](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/sleep.yaml); [skip-send.yaml](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/skip-send.yaml).
