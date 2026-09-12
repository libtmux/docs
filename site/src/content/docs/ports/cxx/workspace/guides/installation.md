---
title: "Install and load a workspace"
description: "Build the local C++ workspace CLI and load a session on a private tmux socket."
port: cxx
product: workspace
sidebar:
  label: "Install and load a workspace"
  group: "Guides"
  order: 23
tableOfContents: true
---

Build and run the native C++ `tmux-workspace` command from the local
`workspace-cli` checkout. **This is a partial, unreleased implementation.**
These commands require that local source; they are not registry installation
instructions or a claim that the CLI is available on the published branch.

## Build from the local checkout

Run these commands from the native repository root. Use a Unix environment
with tmux 3.2a or newer on `PATH` for this walkthrough.

The development preset requires Clang 18.1.3 with libc++ 18.1, CMake 3.25 or
newer, and Ninja. It builds C++23 and fetches pinned optional CLI dependencies.
Core libtmux remains independent of CLI11, yaml-cpp and nlohmann JSON.

```console
$ cmake --preset cxx-dev \
    -DLIBTMUX_BUILD_WORKSPACE_CLI=ON
```

```console
$ cmake --build --preset cxx-dev \
    --target tmux-workspace \
    --parallel 2
```

Use `load -d` for the detached workflow below. The CLI rejects unsupported
legacy `-8` before file or backend access; `-2` selects 256-colour mode.
Several other planned commands/options appear in help with explicit
unavailable behavior.

Inspect the built command:

```console
$ build/cxx-dev/apps/workspace/tmux-workspace --help
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
$ build/cxx-dev/apps/workspace/tmux-workspace load \
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
$ build/cxx-dev/apps/workspace/tmux-workspace freeze \
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

Python shell/plugin/custom-builder execution, animated progress, completion,
full importer/configuration coverage and portable packaging remain unfinished.
Native before scripts, terminal handoff and file logging are implemented; see
[current coverage](../../reference/compatibility/) for their limits. Capture
omits environment/options and cannot recover original command arguments or
history.

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
