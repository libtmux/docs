---
supportedPorts: []
title: Build a workspace from a file
description: Build a tmux command file that creates windows and panes, then load it on a private server.
sidebar:
  label: Build a workspace from a file
  group: Examples
  order: 4
tableOfContents: true
---

A tmux command file can create a session, arrange its windows, and split its
panes. This example builds two windows with three panes, prints their names
and pane counts, then removes its private server. The first four steps write
the command file, and the last four load and inspect it. It requires tmux 3.3a
or newer and a POSIX shell.

## 1. Create a detached session

`new-session -d` creates a session without attaching a terminal. `-s dev` names
it and `-n editor` names its first window. `-x 100 -y 30` sizes that window,
because a detached session has no terminal to size it. The final `'sh'` is the
program in the first pane.

```text excerpt="workspace.conf" from="new-session"
```

## 2. Split the window

`split-window -h` adds a pane beside the first one. `-t '=dev:editor'` names the
window with an exact session name, so the split cannot reach a session whose
name only starts with `dev`.

```text excerpt="workspace.conf" from="split-window"
```

The `editor` window now has two panes. Each runs `sh`.

## 3. Add a second window

`new-window -n logs` adds a window named `logs` with one pane. A new window
becomes the current one.

```text excerpt="workspace.conf" from="new-window"
```

## 4. Choose what is selected

`select-window` and `select-pane` move the focus back to the first pane of the
`editor` window. `.0` is the pane's index in that window.

```text excerpt="workspace.conf" from="select-window" to="select-pane"
```

<a id="define-the-layout"></a>

## The complete command file

Explicit targets keep each command tied to the intended session and window.
Save the four steps together as `workspace.conf`:

```text title="workspace.conf"
new-session -d -s dev -n editor -x 100 -y 30 'sh'
split-window -h -t '=dev:editor' 'sh'
new-window -t '=dev' -n logs 'sh'
select-window -t '=dev:editor'
select-pane -t '=dev:editor.0'
```

## 5. Start a server that stays up

`start-server` starts the private server before any session exists. The `\;`
passes a literal semicolon to tmux, so `set-option -s exit-empty off` runs as
the next command of the same invocation. Without that option the server exits
when it has no sessions, which would leave nothing to stop if the file failed
before creating one.

```sh excerpt="workspace.sh" from="start-server" to="exit-empty off"
```

## 6. Load the file

`source-file` runs each line of the file as a tmux command on this server.
Errors stay visible and make the script fail. Paths in the file are relative to
the directory you run the script from, so keep `workspace.conf` beside it.

```sh excerpt="workspace.sh" from="source-file"
```

## 7. List what was built

`list-windows` prints one row per window of the exact session `dev`. `-F`
formats each row with `#{window_name}` and `#{window_panes}`.

```sh excerpt="workspace.sh" from="list-windows" to="window_panes"
```

## 8. Clean up

`kill-server` stops the private server. `trap cleanup EXIT` runs `cleanup` on
every exit, including a failed `source-file`, so the server never outlives the
script. If tmux cannot be stopped, the script keeps the socket directory and
prints its path.

```sh excerpt="workspace.sh" from="cleanup() {" to="trap 'exit 1'"
```

<a id="build-and-inspect-it"></a>

## The complete script

In the file, `cleanup` comes first so that it covers every command after it.
The parentheses run the script in a subshell, so its `exit` and traps leave
your shell alone. Save it as `workspace.sh` beside the command file:

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
