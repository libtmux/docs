---
description: Tmuxp session configuration, field meanings, defaults, and execution behavior.
product: workspace
sidebar:
  group: Configuration
  label: Session
  order: 31
tableOfContents: true
title: Session configuration
ports:
  ts:
    description: Tmuxp session configuration and current TypeScript builder compatibility.
  rs:
    description: Tmuxp session configuration and current Rust builder compatibility.
  go:
    description: Tmuxp session configuration and current Go builder compatibility.
  java:
    description: Tmuxp session configuration and current Java builder compatibility.
  dotnet:
    description: Tmuxp session configuration and current .NET builder compatibility.
  cxx:
    description: Tmuxp session configuration and current C++ builder compatibility.
  swift:
    description: Tmuxp session configuration and current Swift builder compatibility.
---

<!-- port:py -->This page documents Python tmuxp configuration at the pinned reference revision.
Use tmuxp for the command examples below.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.
<!-- /port -->
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

<!-- port:ts -->## Current TypeScript builder
<!-- /port --><!-- port:rs -->## Current Rust builder
<!-- /port --><!-- port:go -->## Current Go builder
<!-- /port --><!-- port:java -->## Native Java CLI
<!-- /port --><!-- port:dotnet -->## Current .NET builder
<!-- /port --><!-- port:cxx -->## Current C++ builder
<!-- /port --><!-- port:swift -->## Current Swift builder
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->
<!-- /port --><!-- port:ts -->The local CLI supports session environment and before scripts. Explicit plugins
and custom builders use the optional Python bridge described in
[hooks and builders](../hooks/); custom builders may omit `windows`.
<!-- /port --><!-- port:java -->The local CLI accepts session identity, directories, environment, session and
global options, `before_script`, inherited before commands and history policy.
Python plugins and custom builders use an explicit, version-checked runtime;
they do not run through the native builder. Existing-session reuse and append
follow the [load contract](../../cli/load/), including retained partial effects.
<!-- /port --><!-- port:ts,java -->
<!-- /port --><!-- port:ts -->The separate `@libtmux/workspace` library represents session name, start
directory, options and windows. Environment, plugins, before_script and builder
selection remain outside that library's strict schema.
<!-- /port --><!-- port:rs -->Session options, environment, directories, and pre-pane commands have native
fields. Python scripts, plugins, and builder selection need separate execution
support; retaining an unknown key does not run it.
<!-- /port --><!-- port:go -->Global/session options, environment, inherited directories, and pre-pane
commands are supported. `"before_script"`, `"plugins"`, and custom Python builder
fields are rejected.
<!-- /port --><!-- port:dotnet -->The parser supports session names, directories, scalar options, and windows.
Python hooks/plugins, the complete environment runtime, and discovery are
outside its model.
<!-- /port --><!-- port:cxx -->Session names, directories, environment, options, and command-related settings
have native fields. The consumer does not import Python plugins or custom
builders.
<!-- /port --><!-- port:swift -->The model includes session name, directory, and windows. Session
environment/options, plugins, and custom builder fields are outside that model
and can be ignored by decoding.
<!-- /port --><!-- port:ts,rs,go,dotnet,cxx,swift -->
See the [native builder behavior](../../internals/topics/) and [configuration
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

[classic.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/classic.py); [loader.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/loader.py); [load.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/load.py).
