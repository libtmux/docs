---
title: "Install and load a workspace"
description: "Build the local Swift workspace CLI and load a session on a private tmux socket."
port: swift
product: workspace
sidebar:
  label: "Install and load a workspace"
  group: "Guides"
  order: 23
tableOfContents: true
---

Build and run the native Swift `tmux-workspace` command from the local
`workspace-cli` checkout. **This is a partial, unreleased implementation.**
These commands require that local source; they are not registry installation
instructions or a claim that the CLI is available on the published branch.

## Build from the local checkout

Run these commands from the native repository root. Use a Unix environment
with tmux 3.2a or newer on `PATH` for this walkthrough.

Use Swift 6.2 or newer on Linux. On macOS, use Xcode's Swift 6.3 or newer
toolchain; the subprocess dependency requires it. The package targets macOS
13 or newer. Enable the YAML build trait for this walkthrough; JSON-only
builds can omit it.

```console
$ swift build \
    --jobs 2 \
    --traits YAMLWorkspaces \
    --force-resolved-versions \
    --product tmux-workspace
```

Outside tmux, this local loader requires an explicit endpoint. The
walkthrough supplies one with `-S`. A copied Linux executable still needs the
Swift runtime libraries supplied by its toolchain; it is not a standalone
distribution.

Inspect the built command:

```console
$ .build/debug/tmux-workspace --help
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
$ .build/debug/tmux-workspace load \
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
$ .build/debug/tmux-workspace freeze \
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

`load -2` forces 256-color handling in native tmux clients. Legacy `-8` is
recognized but rejected before document lookup because supported tmux versions
do not implement 88-color mode. Without `-2`, tmux detects color support.

`--log-level` filters advisory diagnostics; fatal errors remain visible.
`load --log-file` appends structured lifecycle and diagnostic records to a regular
file. A write failure reports a secondary diagnostic and preserves the load result.

Human load displays progress on terminal stderr, with presets, custom counters
and a bounded recent-output panel. It uses the initial terminal size and
conservative Unicode clipping. Bootstrap output keeps its original stdout or
stderr destination, but is collected before display. Machine output disables
the panel and emits structured window/pane events. Interruption clears the
panel; SIGINT and SIGTERM return status 130 and stop captured children.

Terminal attachment, plugins/custom builders, further pane/window execution
settings, fuller capture, generated manuals and portable distribution remain
unfinished. The complete tmuxp flag surface is not available.

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
