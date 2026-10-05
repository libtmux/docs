---
supportedPorts: []
title: Attaching to tmux
description: Create or attach to a tmux session, select its socket, and keep terminal attachment separate from automation.
sidebar:
  label: Attaching to tmux
  group: Guides
  order: 3
tableOfContents: true
---

Attaching opens a tmux session in your terminal. Its shells and programs keep
running when you detach. A script can also query or control that session
without taking over a terminal.

## Open a session in your terminal

Run this from a terminal outside tmux. It creates `work` if needed and attaches
to it otherwise. `-L libtmux-demo` keeps this demonstration on its own named
server. `-f /dev/null` skips personal tmux configuration for this demonstration.

```console
$ tmux -L libtmux-demo -f /dev/null new-session -A -s work
```

Detach with **Ctrl-b**, then **d**. You return to the original shell while
the tmux session keeps running. List that server's sessions:

```console
$ tmux -L libtmux-demo list-sessions
```

Attach to the existing session again. The leading `=` selects its exact name:

```console
$ tmux -L libtmux-demo attach-session -t '=work'
```

`attach-session` expects a session to exist. `new-session -A` is the command
to use when either creating or attaching is acceptable. From inside tmux,
`attach-session` switches the attached client to the target session.

After detaching, remove the demonstration session when you are finished:

```console
$ tmux -L libtmux-demo kill-session -t '=work'
```

<a id="which-socket-a-bare-constructor-reaches"></a>

## Choose the server socket

A socket identifies a tmux server. Use the same selection on every command:

- `-L name` selects a named socket in tmux's socket directory.
- `-S path` selects an explicit socket path and overrides `-L`.
- Without either flag, tmux uses the socket from `TMUX` when applicable,
  otherwise its default socket.

Inside a pane, `TMUX` identifies its server and `TMUX_PANE` identifies the
pane. Prefer explicit socket selection in automation that may run both
inside and outside tmux.

## Query a session from a shell script

This complete program creates an isolated server, looks up `work`, and prints
its name. Each command stays in the calling shell; no terminal is attached.
It stops its own server on success or failure.

Save it as `connect.sh` and run `sh connect.sh`, or paste the whole block into
a POSIX shell. It requires tmux 3.2a or newer.

```sh title="connect.sh"
(
    set -eu
    directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-attach.XXXXXX")
    socket="$directory/tmux.sock"

    cleanup() {
        status=$?
        trap - 0 HUP INT TERM
        if [ -S "$socket" ] && ! tmux -S "$socket" kill-server; then
            printf 'Cannot stop tmux; kept %s\n' "$directory" >&2
            exit 1
        fi
        rm -rf "$directory" || exit 1
        exit "$status"
    }
    trap cleanup 0
    trap 'exit 1' HUP INT TERM

    unset TMUX TMUX_PANE
    tmux -S "$socket" -f /dev/null new-session -d -s work /bin/cat
    tmux -S "$socket" has-session -t '=work'
    tmux -S "$socket" list-sessions -F '#{session_name}'
)
```

`-d` starts the session without attaching. `/bin/cat` keeps its pane open
without loading a shell configuration. The script addresses only its private
socket. If shutdown fails, it reports the error and keeps that socket's
directory for inspection.

<a id="finding-a-session-instead-of-always-creating-one"></a>

## Find a session before creating one

Use `has-session -t '=name'` to check an exact session name. It exits
unsuccessfully when tmux cannot find the session or contact the server; keep
the diagnostic so you can distinguish those failures.

A lookup does not reserve a name. Another client can create or remove a
session before your next command. Handle the result of `new-session` even
after checking. Use `new-session -A` for the interactive create-or-attach
workflow shown above.

## Connect from a language library

Use the port menu to open this guide with a complete program, imports, build
files, and a private-server launcher. Each program connects to an existing
socket and leaves that server running:

[Python](/py/latest/guides/attaching-to-tmux/) ·
[TypeScript](/ts/latest/guides/attaching-to-tmux/) ·
[Go](/go/latest/guides/attaching-to-tmux/) ·
[Rust](/rs/latest/guides/attaching-to-tmux/) ·
[Java](/java/latest/guides/attaching-to-tmux/) ·
[Kotlin](/kotlin/latest/guides/attaching-to-tmux/) ·
[Scala](/scala/latest/guides/attaching-to-tmux/) ·
[C#](/csharp/latest/guides/attaching-to-tmux/) ·
[F#](/fsharp/latest/guides/attaching-to-tmux/) ·
[C++](/cxx/latest/guides/attaching-to-tmux/) ·
[Swift](/swift/latest/guides/attaching-to-tmux/) ·
[Ruby](/ruby/latest/guides/attaching-to-tmux/) ·
[Lua](/lua/latest/guides/attaching-to-tmux/)

## Where to go next

- [Sending keys](../sending-keys/) explains input and command completion.
- [Capturing output](../capturing-output/) reads a pane's screen and history.
- [Socket and servers](/topics/socket-and-servers/) covers server selection.

The [attach-session reference](/tmux/latest/manual/attach-session/) covers
attachment flags. See [has-session](/tmux/latest/manual/has-session/) for
existence checks and the [global options](/tmux/latest/manual/full/#DESCRIPTION)
for selecting a server socket.

The [tmux manual source](https://github.com/tmux/tmux/blob/94796f6b1182507efac8a272fc309a79e22e58a5/tmux.1)
describes `new-session`, `attach-session`, socket selection, and targeting.
