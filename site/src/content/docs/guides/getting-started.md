---
supportedPorts: []
title: Getting started
description: Create a tmux session, add a window and split it into panes.
sidebar:
  label: Getting started
  group: Guides
  order: 2
tableOfContents: true
---

Create a session, add a window, and split that window into panes. These are the
same tmux objects that the language libraries control.

## Install tmux

Install tmux with your platform's package manager. These examples require tmux
3.2a or newer and a POSIX shell. Confirm the installed version:

```console
$ tmux -V
```

## Run the smallest thing that proves it works

Save this complete script as `start.sh`, or paste its entire block into a shell.
It creates a private server, so it does not need an existing session. Each pane
runs `cat` to keep it alive until cleanup.

```sh title="start.sh"
#!/bin/sh
set -eu
directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-guide.XXXXXX")
socket="$directory/tmux.sock"

cleanup() {
    status=$?
    trap - 0 HUP INT TERM
    if [ -S "$socket" ] && ! tmux -S "$socket" kill-server; then
        printf 'Cannot stop tmux; kept %s\n' "$directory" >&2
        exit 1
    fi
    rm -rf "$directory" || status=$?
    exit "$status"
}
trap cleanup 0
trap 'exit 1' HUP INT TERM

tmux -S "$socket" -f /dev/null new-session -d -s work -n main 'cat'
tmux -S "$socket" new-window -t work: -n editor 'cat'
tmux -S "$socket" split-window -h -t work:editor 'cat'
tmux -S "$socket" list-panes -a -F '#{session_name}:#{window_name}'
```

Run the saved script:

```console
$ sh start.sh
```

The output contains `work:main` once and `work:editor` twice: one session, two
windows, and three panes. The script stops its server on exit, including after
a failed command. If shutdown fails, it reports and retains the socket path.

## What just happened

`-S` selects the server socket. `new-session` starts that server and its first
window; `new-window` adds another window; `split-window` adds a pane. `-d` starts
the session without taking over the terminal. `-f /dev/null` starts this private
server without a user configuration file.

[Server, session, window, pane](/concepts/server-session-window-pane/)
explains the hierarchy. [Attaching to tmux](../attaching-to-tmux/) shows how to
open a session interactively and leave it running after detaching.

## Pick a port

Use the port dropdown for language-specific installation and APIs. The complete
programs below include imports, project files, setup, error handling and cleanup:

[Python](/py/latest/examples/capture-pane-output/) ·
[TypeScript](/ts/latest/examples/capture-pane-output/) ·
[Go](/go/latest/examples/capture-pane-output/) ·
[Rust](/rs/latest/examples/capture-pane-output/) ·
[Java](/java/latest/examples/capture-pane-output/) ·
[Kotlin](/kotlin/latest/examples/capture-pane-output/) ·
[Scala](/scala/latest/examples/capture-pane-output/) ·
[.NET](/dotnet/latest/examples/capture-pane-output/) ·
[F#](/fsharp/latest/examples/capture-pane-output/) ·
[C++](/cxx/latest/examples/capture-pane-output/) ·
[Swift](/swift/latest/examples/capture-pane-output/) ·
[Ruby](/ruby/latest/examples/capture-pane-output/) ·
[Lua](/lua/latest/examples/capture-pane-output/)

## Where to go next

[Sending keys](../sending-keys/) types input, and
[Capturing output](../capturing-output/) reads a result. Use
[Querying and filtering](../querying-and-filtering/) to choose a target.

## tmux reference

The [tmux manual](https://github.com/tmux/tmux/blob/94796f6b1182507efac8a272fc309a79e22e58a5/tmux.1)
documents these commands and their flags.
