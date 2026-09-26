---
description: Tmuxp workspace files and directories, field meanings, defaults, and execution behavior.
product: workspace
sidebar:
  group: Configuration
  label: Files and directories
  order: 36
tableOfContents: true
title: Workspace files and directories
ports:
  ts:
    description: Tmuxp workspace files and directories and current TypeScript builder compatibility.
  rs:
    description: Tmuxp workspace files and directories and current Rust builder compatibility.
  go:
    description: Tmuxp workspace files and directories and current Go builder compatibility.
  java:
    description: Tmuxp workspace files and directories and current Java builder compatibility.
  dotnet:
    description: Tmuxp workspace files and directories and current .NET builder compatibility.
  cxx:
    description: Tmuxp workspace files and directories and current C++ builder compatibility.
  swift:
    description: Tmuxp workspace files and directories and current Swift builder compatibility.
---

<!-- port:py -->This page documents Python tmuxp configuration at the pinned reference revision.
Use tmuxp for the command examples below.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.
<!-- /port -->
Tmuxp accepts an explicit workspace file, a saved workspace name, or a project
directory. The location of the selected file determines how config-relative
paths expand. Use an explicit file while debugging a discovery problem.

Load a file on a dedicated server:

```console
$ tmuxp load \
    -L directory-example \
    -d \
    ./workspace.yaml
```

Load the current project's workspace:

```console
$ tmuxp load .
```

These commands use Python tmuxp and assume the corresponding workspace file
already exists. The first command leaves its session detached; use the session
name from the file when inspecting or cleaning it up.

## Global and local discovery

For the preferred global workspace directory, tmuxp tries TMUXP_CONFIGDIR,
XDG_CONFIG_HOME/tmuxp (or the XDG default), then the legacy [`~/.tmuxp`](../../guides/discovery/)
directory. It chooses the first existing directory. If none exists, it returns
the legacy location. Setting TMUXP_CONFIGDIR to a nonexistent path does not
automatically select that path over an existing fallback.

Project discovery walks the current directory and its parents, choosing at most
one workspace per directory in `.tmuxp.yaml`, [`.tmuxp.yml`](../../guides/discovery/), [`.tmuxp.json`](../../guides/discovery/) order.
It stops at home or filesystem root. `ls` can report global directory candidates
and locally discovered workspaces; that inventory is not identical to resolving
one explicit load argument.

The importers use their own source roots: Teamocil uses [`~/.teamocil`](../../cli/import-teamocil/);
tmuxinator uses TMUXINATOR_CONFIG, with tilde expansion, or [`~/.tmuxinator`](../../cli/import-tmuxinator/).
Their source argument is effectively required, even though the parser's
positional arity looks optional.

## Start directories

```yaml
session_name: directory-example
start_directory: ./
windows:
  - window_name: root
    panes:
      - pwd
  - window_name: child
    start_directory: ./src
    panes:
      - pwd
      - start_directory: ./
        shell_command: pwd
```

This example assumes the project has a `"src"` directory. The first window
inherits the session directory. The child window resolves ./src against the
explicit session directory, and its second pane resolves ./ against that window
directory. Both child panes start in src.

The root start_directory resolves a dot-relative path from the configuration
file's directory. At child levels, the pinned loader resolves dot-relative paths
against the immediate parent's start_directory before inherited defaults are
filled. Define that parent value explicitly when using ./ or ../ in a child. A
missing parent start_directory can raise KeyError during expansion.

A plain relative window directory such as src is joined to the session directory
later, during trickle. A dot-relative pane under that still-relative window can
resolve against the invoking process's current directory first. Use an explicit
./src window value as above, or an absolute path, to avoid that inconsistency.
Native normalization that resolves every child consistently would correct this
reference behavior.

When a document names no `start_directory` at any level, panes start in the
directory the command was run from, not the directory the workspace file lives
in. That is what tmuxp does, and all eight implementations agree on it. An
explicit relative value such as `./src` is the other case: it always resolves
against the workspace file's directory, at every level, so a workspace stays
portable no matter where it is loaded from.

Absolute and expanded-home paths retain their explicit location. Quote `~` in
YAML to avoid its null spelling. A pane override also applies to the first pane
in the Python classic builder. Inspect resolved values and the resulting pane
directory when loading a workspace from a different working directory.

## Missing directories and bootstrap

A nonexistent path can make tmux start somewhere unexpected, including a home
directory, rather than producing a useful configuration error. Inspect the
actual pane directory when verifying a workspace. Native ports may reject,
retain, report, or pass through the value differently.

A relative before_script path is resolved from the workspace file. Its process
working directory uses the session start_directory when supplied. A bootstrap
process can create required project files, but it runs after the initial tmux
session exists. See [hooks](../hooks/) for failure handling and
[environment](../environment/) for variable expansion.

<!-- port:ts -->## Current TypeScript builder
<!-- /port --><!-- port:rs -->## Current Rust builder
<!-- /port --><!-- port:go -->## Current Go builder
<!-- /port --><!-- port:java -->## Native Java CLI
<!-- /port --><!-- port:dotnet -->## Current .NET builder
<!-- /port --><!-- port:cxx -->## Current C++ builder
<!-- /port --><!-- port:swift -->## Current Swift builder
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->
<!-- /port --><!-- port:ts -->Directories inherit from workspace to window to pane. The package does not
implement the tmuxp name/project discovery workflow or its full config-relative
expansion.
<!-- /port --><!-- port:rs -->Directories inherit through native workspace/window/pane values. Config-file
discovery and tmuxp path expansion are not supplied by the workspace library.
<!-- /port --><!-- port:go -->`Workspace.MissingDirectories` reports absent directories before a build. The
caller decides whether to fail or allow setup to create them. Values are not
expanded using tmuxp environment rules.
<!-- /port --><!-- port:java -->The local CLI supports `start_directory` at session, window and pane scope.
Relative paths resolve from the source document's directory, then inherit
through the session/window/pane hierarchy. Tilde and defined invoking-process
variables expand before existing-directory checks. `before_script` uses the
invocation directory unless the workspace sets `start_directory` explicitly.
Imports instead record absolute invocation-based roots before saving.
<!-- /port --><!-- port:dotnet -->Working-directory strings pass to tmux unchanged. Relative paths are not rebased
to the workspace file. Resolve them explicitly before native execution if that
behavior is required.
<!-- /port --><!-- port:cxx -->The model carries directories; config discovery and all tmuxp expansion rules
are not a CLI feature here. Open a core server handle against the intended live
endpoint before using the consumer.
<!-- /port --><!-- port:swift -->A window directory overrides the workspace directory; a split pane can override
both. The first pane uses the window directory. Encoding a Workspace preserves
model values and does not resolve or discover configuration files.
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

[finders.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/finders.py); [loader.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/loader.py); [import_config.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/import_config.py); [classic.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/classic.py); [start-directory.yaml](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/start-directory.yaml).
