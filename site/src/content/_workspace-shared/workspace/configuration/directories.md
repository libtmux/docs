---
description: Resolve saved workspace files and the working directories used by panes.
product: workspace
sidebar:
  group: Configuration
  label: Files and directories
  order: 36
tableOfContents: true
title: Files and directories
---

<!-- port:py -->
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

When a document names no `start_directory` at any level, panes start in the
directory the command was run from, not the directory the workspace file lives
in. Use an explicit session directory and child directories as described above
when loading a file from another working directory.

Absolute and expanded-home paths retain their explicit location. Quote `~` in
YAML to avoid its null spelling. A pane override also applies to the first pane
in the Python classic builder. Inspect resolved values and the resulting pane
directory when loading a workspace from a different working directory.

## Missing directories and bootstrap

A nonexistent path can make tmux start somewhere unexpected, including a home
directory, rather than producing a useful configuration error. Inspect the
actual pane directory when verifying a workspace.

A relative before_script path is resolved from the workspace file. Its process
working directory uses the session start_directory when supplied. A bootstrap
process can create required project files, but it runs after the initial tmux
session exists. See [hooks](../hooks/) for failure handling and
[environment](../environment/) for variable expansion.

## Reference source

[finders.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/finders.py); [loader.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/loader.py); [import_config.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/import_config.py); [classic.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/classic.py); [start-directory.yaml](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/start-directory.yaml).
<!-- /port -->

<!-- port:ts,rs,go,java,dotnet,cxx,swift -->
Use an explicit file path when debugging workspace discovery. A directory such
as `.` selects a project configuration; a saved name selects a global workspace.
See [finding workspaces](../../guides/discovery/) for that lookup order.

## Set a starting directory

```yaml title="directories.yaml"
session_name: directories-example
start_directory: ./
windows:
  - window_name: shell
    start_directory: ./
    panes:
      - start_directory: ./
        shell_command: pwd
```

An explicit relative session directory starts from the configuration file's
directory. Child directories resolve through their parent configuration. Use
absolute paths when a workspace deliberately points outside its project.

Quote home shortcuts in YAML, such as `"~/src/project"`; an unquoted `~` is a
null value. An omitted directory lets the loader and tmux use their invocation
context. The explicit relative directory in this example selects the file's
project context.

## Verify the running pane

A saved path can be absent on another machine. Inspect the real pane directory
after loading rather than relying on successful YAML parsing. tmux can fall back
to a home directory when a requested path does not exist.

Bootstrap paths and process working directories have separate rules. See
[before scripts](../hooks/) before using one to create directories.

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
