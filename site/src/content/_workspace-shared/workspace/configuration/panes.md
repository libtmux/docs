---
description: Tmuxp pane configuration, field meanings, defaults, and execution behavior.
product: workspace
sidebar:
  group: Configuration
  label: Panes
  order: 33
tableOfContents: true
title: Pane configuration
ports:
  ts:
    description: Tmuxp pane configuration and current TypeScript builder compatibility.
  rs:
    description: Tmuxp pane configuration and current Rust builder compatibility.
  go:
    description: Tmuxp pane configuration and current Go builder compatibility.
  java:
    description: Tmuxp pane configuration and current Java builder compatibility.
  dotnet:
    description: Tmuxp pane configuration and current .NET builder compatibility.
  cxx:
    description: Tmuxp pane configuration and current C++ builder compatibility.
  swift:
    description: Tmuxp pane configuration and current Swift builder compatibility.
---

<!-- port:py -->This page documents Python tmuxp configuration at the pinned reference revision.
Use tmuxp for the command examples below.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.
<!-- /port -->
A pane can be a command string, a list of commands, or a mapping of settings.
Each item in the window's `"panes"` list creates one pane; a command list inside
that item describes several commands in that same pane.
<!-- port:dotnet -->
The native .NET CLI creates panes in configuration order. This also holds for
windows with three or more panes: each new split follows the preceding pane.
`pane-base-index` changes their starting index; `focus: true` selects a
configured pane without changing creation order. Layouts determine the final
geometry. See the [native load source](https://github.com/libtmux/libtmux-dotnet/blob/4ac82a5b82fd8cf68d31c70a2a3eb43c587cd7c0/src/LibTmux.Workspace.Cli/ExecutionCommands.cs).
<!-- /port -->
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

<!-- port:ts -->## Current TypeScript builder
<!-- /port --><!-- port:rs -->## Current Rust builder
<!-- /port --><!-- port:go -->## Current Go builder
<!-- /port --><!-- port:java -->## Native Java CLI
<!-- /port --><!-- port:dotnet -->## Current .NET builder
<!-- /port --><!-- port:cxx -->## Current C++ builder
<!-- /port --><!-- port:swift -->## Current Swift builder
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->
<!-- /port --><!-- port:ts -->A pane is a string or supported mapping. Null, bare command lists, shell,
environment, and timed command dictionaries are not the complete tmuxp shapes
accepted here.
<!-- /port --><!-- port:rs -->Pane maps and command strings are supported, but tmuxp bare command lists and
special blank forms have normalization differences. Pane shell and environment
execution require their own compatibility checks.
<!-- /port --><!-- port:go -->A shell on the first pane and window_shell describe the same initial launch; the
Go parser rejects setting both. Tmuxp allows the pane shell to override. Blank
forms and command lists need per-shape compatibility checks.
<!-- /port --><!-- port:java -->The local CLI accepts null and `blank`/`pane`/`empty` shorthand, command strings,
command lists and pane mappings. Mappings support directories, launch
environments, focus, before commands, history policy, Enter and delays. `shell:`
and `pane_shell:` are aliases and cannot both be set. A successful load confirms
command delivery, not a shell command's completion or exit status.
<!-- /port --><!-- port:dotnet -->Pane values support the package's command and directory shapes. The full set of
tmuxp shorthand, shell, environment, and command-mapping forms is not accepted.
<!-- /port --><!-- port:cxx -->Native pane commands support Enter, pause, and history metadata. Exact shorthand
and shell/environment combinations still need the parser and execution behavior
checked separately.
<!-- /port --><!-- port:swift -->The first pane is created with its window directory; split panes can supply a
pane directory. This differs from tmuxp, which also lets the first pane override
its directory. Command decoding accepts fewer forms.
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

[loader.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/loader.py); [classic.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/classic.py); [blank-panes.yaml](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/blank-panes.yaml); [pane-shell.yaml](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/pane-shell.yaml).
