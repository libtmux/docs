---
description: Choose pane commands, launch settings and focus.
product: workspace
sidebar:
  group: Configuration
  label: Pane configuration
  order: 33
tableOfContents: true
title: Pane configuration
---

<!-- port:py -->
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

## Reference source

[loader.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/loader.py); [classic.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/classic.py); [blank-panes.yaml](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/blank-panes.yaml); [pane-shell.yaml](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/pane-shell.yaml).
<!-- /port -->

<!-- port:ts,rs,go,java,dotnet,cxx,swift -->
Each entry in a window's `panes` list describes one pane. A string is a command;
`null` leaves a blank shell pane. A mapping provides launch and command settings.

```yaml title="panes.yaml"
session_name: panes-example
windows:
  - window_name: work
    layout: even-horizontal
    panes:
      - null
      - shell: /bin/sh
        focus: true
        shell_command:
          - printf ready
          - printf second
```

The second pane launches `/bin/sh`, receives both commands in order and becomes
the active pane. A command list inside one pane does not create extra panes.

## Overrides

- `start_directory` overrides the inherited working directory.
- `shell` overrides the window's launch command.
- `environment` supplies the pane's launch environment map.
- `shell_command_before` adds setup after session and window setup.
- `enter`, `sleep_before` and `sleep_after` supply command defaults.
- `suppress_history` overrides the inherited history policy.

Set focus explicitly when automation depends on which pane is selected. Use
returned pane IDs for later operations instead of assuming that creation order
is a stable tmux ID.

Read [commands](../commands/) for Enter and delay behavior and
[environment](../environment/) for variable handling.

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
