---
supportedPorts: []
title: Socket and servers
description: Select a native tmux server, inspect its socket and process, and keep independent servers separate.
sidebar:
  label: Socket and servers
  group: Topics
  order: 10
tableOfContents: true
---

A tmux server listens on a Unix-domain socket. Every client command selects
one server. Use the same socket selection when creating objects, reading state,
sending input, and cleaning up.

## Select a server

`-L` selects a socket name below tmux's per-user socket directory. `-S` selects
an explicit socket path; when supplied, it takes precedence over `-L`. Without
an explicit selection, a client inside tmux can use the server recorded in
`TMUX`; an outside client uses the default socket.

Save this complete script as `sockets.sh`. It requires tmux 3.2a or newer and
a POSIX shell. It starts two private servers with the same session name,
changes one, and verifies that the other is unaffected.

```sh title="sockets.sh"
#!/bin/sh
set -eu
directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-sockets.XXXXXX")
socket="$directory/tmux.sock"

other="$directory/other.sock"
cleanup() {
    status=$?
    trap - 0 HUP INT TERM
    failed=no
    for address in "$socket" "$other"; do
        if [ -S "$address" ] && ! tmux -S "$address" kill-server; then
            failed=yes
        fi
    done
    if [ "$failed" = yes ]; then
        printf 'Cannot stop tmux; kept %s\n' "$directory" >&2
        exit 1
    fi
    rm -rf "$directory" || status=$?
    exit "$status"
}

trap cleanup 0
trap 'exit 1' HUP INT TERM

tmux -S "$socket" -f /dev/null new-session -d -s work 'cat'
tmux -S "$other" -f /dev/null new-session -d -s work 'cat'
selected=$(tmux -S "$socket" display-message -p '#{socket_path}')
[ "$selected" = "$socket" ]
first_pid=$(tmux -S "$socket" display-message -p '#{pid}')
second_pid=$(tmux -S "$other" display-message -p '#{pid}')
[ "$first_pid" != "$second_pid" ]
printf 'servers have different PIDs\n'

tmux -S "$socket" rename-session -t '=work' renamed
first=$(tmux -S "$socket" list-sessions -F '#{session_name}')
second=$(tmux -S "$other" list-sessions -F '#{session_name}')
[ "$first" = renamed ] && [ "$second" = work ]
printf 'first server: %s\nsecond server: %s\n' "$first" "$second"
```

Run the saved script:

```console
$ sh sockets.sh
```

The output is `servers have different PIDs`, `first server: renamed`, and
`second server: work` on separate lines. Both private servers are stopped by
the cleanup trap.

## Check the selected server

[`display-message -p`](/tmux/latest/manual/display-message/) evaluates formats
on the selected server. `#{socket_path}` reports its socket and `#{pid}` its
process ID. [`list-sessions`](/tmux/latest/manual/list-sessions/) lists that
server's sessions. The IDs assigned inside two independent servers can be
the same; an ID needs its server context.

[`has-session`](/tmux/latest/manual/has-session/) checks a particular session.
A failed lookup does not by itself prove that no server exists: the server
may be running with other sessions or with `exit-empty` disabled. Preserve
standard error when diagnosing a failed connection or target lookup.

## Own the socket lifecycle

[`new-session`](/tmux/latest/manual/new-session/) starts a server if needed.
`-f /dev/null` skips configuration when that server starts; it does not reset
an existing server's configuration. Use a new directory when a test must own
the server from creation through cleanup.

The socket path can be reused after a server stops. Cached object IDs can
then refer to a different server lifetime. Re-read state after a restart
instead of applying old IDs to a replacement daemon.
[`kill-server`](/tmux/latest/manual/kill-server/) stops every session on the
selected server. Use it only when that server is the resource you own.
The [isolated test guide](/guides/testing-with-libtmux/) demonstrates that
cleanup boundary.

The pinned
[tmux manual](https://github.com/tmux/tmux/blob/e476c1230b958df0cb12977517d24b3dc931375b/tmux.1)
documents the commands and formats used here.
