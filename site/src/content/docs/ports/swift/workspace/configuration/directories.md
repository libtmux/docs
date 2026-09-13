---
title: "Workspace files and directories"
description: "Tmuxp workspace files and directories and current Swift builder compatibility."
port: swift
product: workspace
sidebar:
  group: Configuration
  label: "Files and directories"
  order: 36
tableOfContents: true
---

**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.

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

## Current Swift builder

A window directory overrides the workspace directory; a split pane can override
both. The first pane uses the window directory. Encoding a Workspace preserves
model values and does not resolve or discover configuration files.

See the [native builder behavior](../../internals/topics/) and [configuration
source](https://github.com/libtmux/libtmux-swift/blob/94b9e4cc436dda8e18e064179ae7d26e55bbbd73/Sources/TmuxWorkspace/Workspace.swift)
before using these fields through application code.

## Reference source

[finders.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/finders.py); [loader.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/loader.py); [import_config.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/import_config.py); [classic.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/classic.py); [start-directory.yaml](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/start-directory.yaml).
