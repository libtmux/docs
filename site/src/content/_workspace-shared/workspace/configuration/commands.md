---
description: Tmuxp workspace commands, field meanings, defaults, and execution behavior.
product: workspace
sidebar:
  group: Configuration
  label: Commands
  order: 34
tableOfContents: true
title: Workspace commands
ports:
  ts:
    description: Tmuxp workspace commands and current TypeScript builder compatibility.
  rs:
    description: Tmuxp workspace commands and current Rust builder compatibility.
  go:
    description: Tmuxp workspace commands and current Go builder compatibility.
  java:
    description: Tmuxp workspace commands and current Java builder compatibility.
  dotnet:
    description: Tmuxp workspace commands and current .NET builder compatibility.
  cxx:
    description: Tmuxp workspace commands and current C++ builder compatibility.
  swift:
    description: Tmuxp workspace commands and current Swift builder compatibility.
---

<!-- port:py -->This page documents Python tmuxp configuration at the pinned reference revision.
Use tmuxp for the command examples below.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.
<!-- /port -->
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

<!-- port:ts -->## Current TypeScript builder
<!-- /port --><!-- port:rs -->## Current Rust builder
<!-- /port --><!-- port:go -->## Current Go builder
<!-- /port --><!-- port:java -->## Native Java CLI
<!-- /port --><!-- port:dotnet -->## Current .NET builder
<!-- /port --><!-- port:cxx -->## Current C++ builder
<!-- /port --><!-- port:swift -->## Current Swift builder
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->
<!-- /port --><!-- port:ts -->The default native policy sends commands only to newly created panes. `commands:
"always"` also replays commands in reused panes. These library options are not
tmuxp YAML keys.
<!-- /port --><!-- port:rs -->The native model is narrower than the command dictionaries and normalization
described here. Do not assume enter/delay overrides or tmuxp expansion follow
from accepting a YAML mapping.
<!-- /port --><!-- port:go -->Command dictionaries support enter and delays in seconds. Tmuxp interpolation is
absent. Verify override carry behavior against the reference before using a
timing-sensitive configuration.
<!-- /port --><!-- port:java -->The local CLI supports command strings, lists and `{cmd, enter, sleep_before,
sleep_after}` objects. Enter and delay defaults carry forward until an explicit
override. Before commands accumulate in session/window/pane order, and history
suppression prefixes delivered commands with a space. Command variables remain
for the pane shell to expand; this differs from tmuxp's invoking-process
expansion. [Readiness policy](../../reference/compatibility/) is separate from
command completion.
<!-- /port --><!-- port:dotnet -->The package supports scalar or ordered shell command strings. Its readiness
policy concerns prompt detection; it does not add the reference command
dictionary timing and override semantics.
<!-- /port --><!-- port:cxx -->Command metadata supports enter, delays, and suppression. The consumer creates
topology before delivering commands; it does not perform the complete tmuxp
normalization pipeline.
<!-- /port --><!-- port:swift -->Swift commands carry command text and Enter behavior. The reference delay
dictionaries, inherited before commands, history suppression, and variable
expansion are not supplied by that model.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->
<!-- /port --><!-- port:ts,rs,go,dotnet,cxx,swift -->See the [native builder behavior](../../internals/topics/) and [configuration
<!-- /port --><!-- port:ts -->source](https://github.com/libtmux/libtmux-ts/blob/f85b8de551353f746d50eaf36bf0112f4fe5a528/packages/workspace/src/config.ts)
<!-- /port --><!-- port:rs -->source](https://github.com/libtmux/libtmux-rs/blob/4a9afac1d82d9a6a9af16099e7b846e69f0e6388/crates/tmux-workspace/src/config.rs)
<!-- /port --><!-- port:go -->source](https://github.com/libtmux/libtmux-go/blob/bb48780c49652d6b7a17884f19a93c269f04a688/workspace/workspace.go)
<!-- /port --><!-- port:dotnet -->source](https://github.com/libtmux/libtmux-dotnet/blob/b71b9654f41785c93717e454cbf176672b3d634a/src/LibTmux.Workspace/WorkspaceYamlParser.cs)
<!-- /port --><!-- port:cxx -->source](https://github.com/libtmux/libtmux-cxx/blob/c7f1146d2ebd7a8323d9f9814517dc3cdf86b4ee/examples/workspace/src/tmuxp.cpp)
<!-- /port --><!-- port:swift -->source](https://github.com/libtmux/libtmux-swift/blob/94b9e4cc436dda8e18e064179ae7d26e55bbbd73/Sources/TmuxWorkspace/Workspace.swift)
<!-- /port --><!-- port:ts,rs,go,dotnet,cxx,swift -->before using these fields through application code.
<!-- /port --><!-- port:java -->See the [CLI configuration parser](https://github.com/libtmux/libtmux-java/blob/2d7e8028986b99c8e9496dc40b5d1e90fb2368c9/workspace-cli/src/main/java/io/github/libtmux/workspace/cli/WorkspacePlan.java).
Application code using the lower-level workspace library has a separate
[builder API](../../internals/topics/). Its schema is not the CLI configuration
contract.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->
<!-- /port -->## Reference source

[loader.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/loader.py); [classic.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/classic.py); [sleep.yaml](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/sleep.yaml); [skip-send.yaml](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/skip-send.yaml).
