---
description: Order pane setup and command delivery, Enter handling and delays.
product: workspace
sidebar:
  group: Configuration
  label: Workspace commands
  order: 34
tableOfContents: true
title: Workspace commands
---

<!-- port:py -->
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
<!-- /port -->

<!-- port:ts,rs,go,java,csharp,cxx,swift -->
`shell_command_before` adds setup for every affected pane. Setup is ordered from
session to window to pane, followed by that pane's `shell_command` entries.

```yaml title="commands.yaml"
session_name: commands-example
shell_command_before:
  - printf session-setup
windows:
  - window_name: shell
    shell_command_before:
      - printf window-setup
    panes:
      - shell_command_before:
          - printf pane-setup
<!-- port:swift -->
        sleep_after: 0.01
<!-- /port -->
        shell_command:
          - cmd: printf ready
<!-- port:ts,rs,go,java,csharp,cxx -->
            sleep_after: 0.01
<!-- /port -->
          - cmd: printf waiting
            enter: false
<!-- port:ts,rs,go,java,csharp,cxx -->
            sleep_after: 0
<!-- /port -->
```

The final command is typed without Enter. Delays are measured in seconds and
pause delivery; they do not verify that an application is ready or that an
earlier shell command succeeded.

## Enter and timing

Pane-level `enter`, `sleep_before` and `sleep_after` establish defaults.

<!-- port:ts,rs,go,java,csharp,cxx -->
Command mappings can change those defaults. An override carries to following
commands in that pane until another override. Set an explicit value when later
commands need to restore Enter or remove a delay.
<!-- /port -->
<!-- port:swift -->
Command mappings can override Enter, and that override carries to following
commands. Set delays on the pane; timing fields inside command mappings are
refused.
<!-- /port -->

## History and readiness

History suppression prefixes sent commands with a space. The shell still needs
its own setting to ignore leading-space commands, such as Bash's
`HISTCONTROL=ignorespace` or zsh's `HIST_IGNORE_SPACE`.

Prompt readiness delays initial input while a shell draws its prompt. It is
separate from application readiness and command completion. Use a checked
[before script](../hooks/) for bootstrap work whose exit status must stop the
load on failure.

See [environment](../environment/) before putting variable expressions in
commands.

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
