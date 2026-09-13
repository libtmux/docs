---
title: "Install and load a workspace"
description: "Build the local Go workspace CLI and load a session on a private tmux socket."
port: go
product: workspace
sidebar:
  label: "Install and load a workspace"
  group: "Guides"
  order: 23
tableOfContents: true
---

Build and run the native Go `tmux-workspace` command from the local
`workspace-cli` checkout. **This is a partial, unreleased implementation.**
These commands require that local source; they are not registry installation
instructions or a claim that the CLI is available on the published branch.

## Build from the local checkout

Run these commands from the native repository root. Use a Unix environment
with tmux 3.2a or newer on `PATH` for this walkthrough.

Use Go 1.26 or newer, as required by the checkout's
[workspace module](https://github.com/libtmux/libtmux-go/blob/master/workspace/go.mod).
Build from the repository root so its Go workspace selects the local modules.

```console
$ GOMAXPROCS=2 go build \
    -p 2 \
    -o tmux-workspace \
    ./workspace/cmd/tmux-workspace
```

Ordinary search uses Go regular expressions. Python-only regex behavior is
explicitly selected with `--regex-engine python`; it checks Python 3.10 or newer.
Python shell and plugin/custom-builder execution require tmuxp 1.74.0.
Plugin append uses the current session when the document has no `before_script`
key. Native before-script arguments validate for all inputs before any session
is created or changed.

Inspect the built command:

```console
$ ./tmux-workspace --help
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
$ ./tmux-workspace load \
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
$ ./tmux-workspace freeze \
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

Append through the Python workspace bridge with a document `before_script`
key is unavailable and fails during preflight, including empty or null values.
This prevents Python's script-failure cleanup from deleting the borrowed
session. Native scripted append remains supported.

`load -s` changes only the final input's session name; earlier inputs keep
their configured names. Legacy `-8` and `--88-colors` fail before workspace
lookup or runtime checks. Use `-2` to request 256-color mode.

Some cleanup and interruption paths, diagnostic filtering, complete
configuration coverage, and portable packaging still need work. Capture cannot
reconstruct original command arguments, history or workspace extensions.

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
