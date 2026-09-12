---
title: "Install and load a workspace"
description: "Build the local Java workspace CLI and load a session on a private tmux socket."
port: java
product: workspace
sidebar:
  label: "Install and load a workspace"
  group: "Guides"
  order: 23
tableOfContents: true
---

Build and run the native Java `tmux-workspace` command from the local
`workspace-cli` checkout. **This is a partial, unreleased implementation.**
These commands require that local source; they are not registry installation
instructions or a claim that the CLI is available on the published branch.

## Build from the local checkout

Run these commands from the native repository root. Use a Unix environment
with tmux 3.2a or newer on `PATH` for this walkthrough.

Use JDK 21 or newer and the repository's Gradle wrapper. The local
application distribution includes its Java dependencies and needs Java on
`PATH`, or `JAVA_HOME` set to a compatible JDK.

```console
$ ./gradlew :workspace-cli:installDist \
    --max-workers=2 \
    --no-parallel
```

Keep the generated distribution together: its launcher uses libraries
beside it. This local application distribution is separate from published
Java library artifacts.

Inspect the built command:

```console
$ workspace-cli/build/install/tmux-workspace/bin/tmux-workspace --help
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
$ workspace-cli/build/install/tmux-workspace/bin/tmux-workspace load \
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
$ workspace-cli/build/install/tmux-workspace/bin/tmux-workspace freeze \
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

Human load progress uses terminal stderr, with five presets or a custom
`--progress-format` and a bounded `--progress-lines` panel. It preserves script
stdout/stderr, clears on completion or interruption, and is disabled for machine
output, redirected stderr, `TERM=dumb`, `--no-progress` or `TMUXP_PROGRESS=0`.

Python plugins and custom builders execute through the checked tmuxp bridge.
Extension append rejects documents containing `before_script` to preserve the
borrowed session. Complete configuration/capture coverage and full
terminal/platform acceptance remain unfinished. Progress uses the initial
terminal dimensions; it does not track resizing, and Unicode clipping is
conservative.

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
