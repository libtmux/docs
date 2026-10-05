---
supportedPorts: []
title: Build a workspace from a file
description: Create tmux windows and panes from a command file on a private server.
sidebar:
  label: Build a workspace from a file
  group: Examples
  order: 4
tableOfContents: true
---

A tmux command file can create a session, arrange its windows, and split its
panes. This example builds two windows with three panes, prints their names
and pane counts, then removes its private server. It requires tmux 3.2 or
newer and a POSIX shell.

## Define the layout

Save this command file:

```text title="workspace.conf"
new-session -d -s dev -n editor -x 100 -y 30 'sh'
split-window -h -t '=dev:editor' 'sh'
new-window -t '=dev' -n logs 'sh'
select-window -t '=dev:editor'
select-pane -t '=dev:editor.0'
```

The `editor` window has two panes; `logs` has one. Each pane starts `sh`.
Explicit targets keep each command tied to the intended session and window.

## Build and inspect it

Save this complete program as `workspace.sh` beside the configuration file:

```sh title="workspace.sh"
(
    set -eu
    directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-workspace.XXXXXX")
    socket="$directory/tmux.sock"

    cleanup() {
        status=$?
        trap - EXIT
        if [ -S "$socket" ] && ! tmux -S "$socket" kill-server; then
            printf '%s\n' "Cannot stop tmux; kept $directory." >&2
            exit 1
        fi
        rm -rf "$directory" || status=$?
        exit "$status"
    }
    trap cleanup EXIT
    trap 'exit 1' HUP INT TERM

    tmux -S "$socket" -f /dev/null start-server \; \
        set-option -s exit-empty off
    tmux -S "$socket" source-file ./workspace.conf
    tmux -S "$socket" list-windows -t '=dev' \
        -F '#{window_name}: #{window_panes} panes'
)
```

Run it from that directory:

```console
$ sh workspace.sh
```

The result is:

```text
editor: 2 panes
logs: 1 panes
```

`source-file` executes the configuration on the private server. Setting
`exit-empty` to `off` keeps that server available for cleanup even when a
configuration error prevents session creation. Errors remain visible and
make the program fail. Cleanup runs after partial creation too; if stopping
tmux fails, the script keeps the socket directory and reports its location.

## Use a workspace manager

For YAML or JSON configuration, validation, and language APIs, choose a port:

<a id="python"></a>[Python CLI](/py/latest/workspace/examples/) ·
<a id="typescript"></a>[TypeScript](/ts/latest/workspace/internals/examples/) ·
<a id="go"></a>[Go](/go/latest/workspace/internals/examples/) ·
<a id="rust"></a>[Rust](/rs/latest/workspace/internals/examples/) ·
<a id="java"></a>[Java](/java/latest/workspace/internals/examples/) ·
<a id="net"></a>[C#](/csharp/latest/workspace/internals/examples/) ·
<a id="c"></a>[C++](/cxx/latest/workspace/internals/examples/) ·
<a id="swift"></a>[Swift](/swift/latest/workspace/internals/examples/)

The [workspace concept guide](/concepts/workspaces/) explains configuration
and ownership. The [capture example](/examples/capture-pane-output/) shows
how to wait for pane output after sending a command.

<a id="where-this-comes-from"></a>
<a id="source-inclusion"></a>

The [tmux manual source](https://github.com/tmux/tmux/blob/94796f6b1182507efac8a272fc309a79e22e58a5/tmux.1)
describes `source-file`, window targets, and `exit-empty`.
