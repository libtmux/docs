---
title: "Install and load a workspace"
description: "Build the local .NET workspace CLI and load a session on a private tmux socket."
port: dotnet
product: workspace
sidebar:
  label: "Install and load a workspace"
  group: "Guides"
  order: 23
tableOfContents: true
---

Build and run the native .NET `tmux-workspace` command from the local
`workspace-cli` checkout. **This is a partial, unreleased implementation.**
These commands require that local source; they are not registry installation
instructions or a claim that the CLI is available on the published branch.

## Build from the local checkout

Run these commands from the native repository root. Use a Unix environment
with tmux 3.2a or newer on `PATH` for this walkthrough.

Use the .NET SDK selected by the checkout's
[global.json](https://github.com/libtmux/libtmux-dotnet/blob/master/global.json),
currently SDK 10.0.302. The local tool targets .NET 8 and .NET 10 on Unix.
The tool installation below needs a compatible .NET runtime.
For an SDK outside the platform's default installation location, set
`DOTNET_ROOT` to that installation directory before running the tool.

```console
$ dotnet pack src/LibTmux.Workspace.Cli/LibTmux.Workspace.Cli.csproj \
    --configuration Release \
    --output artifacts/packages \
    -m:2
```

```console
$ dotnet tool install LibTmux.Workspace.Cli \
    --tool-path artifacts/tools \
    --add-source artifacts/packages \
    --prerelease
```

The first command creates a local tool package; the second installs from
that package directory. These instructions do not claim a published CLI
package. Installed-package acceptance still needs to be repeated after the
latest lifecycle corrections.

Inspect the built command:

```console
$ artifacts/tools/tmux-workspace --help
```

## Create the input

Keep this shell open for the walkthrough. Create a temporary directory for
its configuration and private tmux socket:

```console
$ WORKSPACE_TMP="$(mktemp -d)"
```

Write a minimal configuration with two blank shell panes to
[`workspace.yaml`](./#create-the-input) inside that directory:

```console
$ cat > "$WORKSPACE_TMP/workspace.yaml" <<'YAML'
session_name: workspace-guide
windows:
  - window_name: editor
    layout: even-horizontal
    panes: [null, null]
YAML
```

## Load and inspect

Load detached on the temporary socket. The JSON result describes the load;
`-d` prevents terminal attachment:

```console
$ artifacts/tools/tmux-workspace load \
    -S "$WORKSPACE_TMP/tmux.sock" \
    -d \
    --json \
    "$WORKSPACE_TMP/workspace.yaml"
```

Inspect the two panes through the same endpoint:

```console
$ tmux \
    -S "$WORKSPACE_TMP/tmux.sock" \
    list-panes \
    -t '=workspace-guide:editor'
```

Attach with tmux when ready:

```console
$ tmux \
    -S "$WORKSPACE_TMP/tmux.sock" \
    attach-session \
    -t '=workspace-guide'
```

Detach with your configured tmux detach binding. Capture the live session
without choosing a file destination:

```console
$ artifacts/tools/tmux-workspace freeze \
    -S "$WORKSPACE_TMP/tmux.sock" \
    --json \
    workspace-guide
```

Capture reports recoverable live state. It cannot reconstruct the original
command history, script or plugin definitions. Remove the walkthrough session
when finished:

```console
$ tmux \
    -S "$WORKSPACE_TMP/tmux.sock" \
    kill-session \
    -t '=workspace-guide'
```

The configuration remains in the temporary directory until you remove it.
Every tmux command above addresses that private socket.

## Current limits

Native `--log-level` filters optional diagnostics. On Linux x64, human load
displays progress on terminal stderr and `load --log-file` appends structured
logs. See the [load reference](../../cli/load/#progress-and-script-output) and
[output reference](../../reference/output/) for settings, resize and log-failure
limits.

Human prompts and full terminal workflows, plugin and custom-builder
validation, contextual completion, and the full configuration and platform
corpus remain unfinished.

Python-specific shell behavior requires an interpreter with tmuxp 1.74.0
installed. Select it with `TMUX_WORKSPACE_PYTHON`. Ordinary native loading of
this example does not require Python.

## Python alternative

For the separate released tmuxp application, install its isolated Python
tool environment with uv:

```console
$ uv tool install tmuxp
```

Follow the [Python installation guide](/py/latest/workspace/guides/installation/)
for that workflow. Installing tmuxp does not install the native command.

## Continue

[Discovery](../discovery/), [configuration](../../configuration/) and the
[load reference](../../cli/load/) explain the tmuxp compatibility model. Compare
those references with the local command's help and the limits above.
[Export and reload](../export-session/) explains the capture workflow, and the
[compatibility reference](../../reference/compatibility/) records builder gaps.
Use [Internals](../../internals/) for the library and consumer APIs.

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
