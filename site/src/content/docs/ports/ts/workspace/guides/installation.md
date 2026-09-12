---
title: "Install and load a workspace"
description: "Build the local TypeScript workspace CLI and load a session on a private tmux socket."
port: ts
product: workspace
sidebar:
  label: "Install and load a workspace"
  group: "Guides"
  order: 23
tableOfContents: true
---

Build and run the native TypeScript `tmux-workspace` command from the local
`workspace-cli` checkout. **This is a partial, unreleased implementation.**
These commands require that local source; they are not registry installation
instructions or a claim that the CLI is available on the published branch.

## Build from the local checkout

Run these commands from the native repository root. Use a Unix environment
with tmux 3.2a or newer on `PATH` for this walkthrough.

Use the Bun version in the checkout's `packageManager` field to install dependencies
and build. Run the result with Node.js 22 or newer, or Bun 1.3.14 or newer. Build the core before the
CLI, running the two build commands sequentially.

```console
$ bun install --frozen-lockfile
```

```console
$ bun run --cwd packages/libtmux build
```

```console
$ bun run --cwd packages/workspace-cli build
```

The local package names its executable `tmux-workspace`; this walkthrough
runs the built entrypoint through Node. Bun can run the same entrypoint. Keep
the complete generated output directory, including split chunks, and the
local core dependency. Installing the published core library alone does not
install this unreleased CLI.

Inspect the built command:

```console
$ node packages/workspace-cli/dist/main.js --help
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
$ node packages/workspace-cli/dist/main.js load \
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
$ node packages/workspace-cli/dist/main.js freeze \
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

Interactive prompts and complete configuration/platform acceptance remain
unfinished. Capture reports live state rather than recovering the original
workspace commands or extension intent.

Python shell evaluation and explicit plugin/custom-builder loads require an
interpreter with tmuxp 1.74.0 installed. Select it with
`TMUX_WORKSPACE_PYTHON`; the default is `python3`. Install extension packages in
that interpreter or provide `workspace_builder_paths` relative to the workspace
file. See [hooks and builders](../../configuration/hooks/) for append and failure
behavior. Ordinary native loading of this example does not require Python.

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
