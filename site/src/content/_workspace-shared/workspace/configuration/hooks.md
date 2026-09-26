---
description: Tmuxp workspace hooks and builders, field meanings, defaults, and execution behavior.
product: workspace
sidebar:
  group: Configuration
  label: Hooks and builders
  order: 38
tableOfContents: true
title: Workspace hooks and builders
ports:
  ts:
    description: Tmuxp workspace hooks and builders and current TypeScript builder compatibility.
  rs:
    description: Tmuxp workspace hooks and builders and current Rust builder compatibility.
  go:
    description: Tmuxp workspace hooks and builders and current Go builder compatibility.
  java:
    description: Tmuxp workspace hooks and builders and current Java builder compatibility.
  dotnet:
    description: Tmuxp workspace hooks and builders and current .NET builder compatibility.
  cxx:
    description: Tmuxp workspace hooks and builders and current C++ builder compatibility.
  swift:
    description: Tmuxp workspace hooks and builders and current Swift builder compatibility.
---

<!-- port:py -->This page documents Python tmuxp configuration at the pinned reference revision.
Use tmuxp for the command examples below.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.
<!-- /port --><!-- port:dotnet -->
The local .NET CLI supports native before scripts and a checked Python bridge
for plugins and custom builders. Append with Python extensions is unavailable:
it fails before building any input or starting Python. Use `-d` to load those
extensions into a separate session. Empty `plugins: []` and a null
`workspace_builder` use native loading. The library builder has the separate
limits described [below](#current-net-builder).
<!-- /port -->
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

<!-- port:ts -->## Current TypeScript builder
<!-- /port --><!-- port:rs -->## Current Rust builder
<!-- /port --><!-- port:go -->## Current Go builder
<!-- /port --><!-- port:java -->## Native Java CLI
<!-- /port --><!-- port:dotnet -->## Current .NET builder
<!-- /port --><!-- port:cxx -->## Current C++ builder
<!-- /port --><!-- port:swift -->## Current Swift builder
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->
<!-- /port --><!-- port:ts -->The local `tmux-workspace load` CLI runs ordinary workspaces without Python.
Explicit `plugins` or `workspace_builder` selections use an interpreter with
tmuxp 1.74.0 installed. `TMUX_WORKSPACE_PYTHON` selects it; the default is
`python3`. Empty plugin lists and blank builder names stay native.
<!-- /port --><!-- port:go -->The library package rejects `before_script` and Python plugins. The local
`tmux-workspace` CLI has a separate native before-script runner and a checked
Python adapter for plugins and custom builders.
<!-- /port --><!-- port:java -->The local CLI runs `before_script` through native child-process services and
supports inherited pane before commands. Python plugins and custom builders use
the explicit tmuxp bridge with version and import-path checks before mutation.
Their arbitrary effects remain outside native rollback guarantees. Native load
reports owned cleanup and retained borrowed-state changes; it cannot reverse
shell side effects.
<!-- /port --><!-- port:ts,go,java -->
<!-- /port --><!-- port:ts -->The adapter expands common fields and resolves `workspace_builder_paths`
relative to the workspace file. Explicit custom builders may omit `windows`
and consume their own configuration. Append keeps the authenticated current
session across input files. Python extension append rejects `before_script`;
run that script separately. Native append supports before scripts.

Extension output is streamed and retained within the CLI's capture limit.
Progress shows a workspace label without native pane counters. Results describe
observed changes, which may include concurrent work; the CLI does not claim
ownership or roll back extension effects. See [output](../../reference/output/)
and [compatibility status](../../reference/compatibility/) for the result fields
and cancellation behavior.

The separate `@libtmux/workspace` library's apply policies cover ownership,
pruning and command replay; they do not implement Python hooks.
<!-- /port --><!-- port:rs -->The library builder does not import Python plugins or custom workspace builders.
The local Rust CLI runs those extensions through a checked tmuxp 1.74.0 bridge.
Append retains the borrowed session and checks its daemon identity before
extension imports and again before building. A missing or replaced target is
rejected. These checks do not constrain mutations performed by extension code.
<!-- /port --><!-- port:go -->Native append retains its borrowed session and rechecks it before each build.
The Python adapter checks the borrowed daemon and session before importing
extensions and after constructing the builder. Plugin append with a document
`before_script` key is unavailable, including an empty or null value. These
checks do not constrain arbitrary plugin code or make its later execution
atomic against an external server replacement.
<!-- /port --><!-- port:dotnet -->The native builder exposes pane-readiness behavior through its own options.
Python plugins, before_script, and custom Python builder imports are
unsupported. Similar readiness option names do not establish full hook parity.
<!-- /port --><!-- port:cxx -->The source consumer does not run Python plugin or builder imports.
Session-building code can be extended in C++, but that is a distinct interface
from tmuxp workspace hook configuration.
<!-- /port --><!-- port:swift -->The Swift model does not load Python plugins, custom builders, or before_script.
Its cleanup policy is a native builder concern: it attempts scoped rollback and
reports original and cleanup failures when both occur.
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

[classic.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/classic.py); [registry.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/registry.py); [protocol.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/protocol.py); [options.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/options.py); [plugins.md](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/docs/topics/plugins.md).
