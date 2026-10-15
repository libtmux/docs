---
supportedPorts: []
title: Architecture
description: Understand native tmux clients, servers, pane processes, command queues, and state reads.
sidebar:
  label: Architecture
  group: Topics
  order: 2
tableOfContents: true
---

tmux runs a server that owns sessions, window links, windows, and panes.
Clients connect through a Unix-domain socket to issue commands or display a
session. Programs inside panes run through pseudo-terminals managed by the
server. A command client can exit while the server and pane programs continue.

## Observe the server across client commands

Save this complete script as `architecture.sh`. It requires tmux 3.2a or
newer and a POSIX shell. It starts a private server, reads it through separate
clients, and verifies that its session survives with no attached clients.

```sh title="architecture.sh"
#!/bin/sh
set -eu
directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-architecture.XXXXXX")
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

tmux -S "$socket" -f /dev/null \
    new-session -d -s work -n editor 'cat' \; \
    new-window -d -t '=work:' -n logs 'cat'
first_pid=$(tmux -S "$socket" display-message -p '#{pid}')
state=$(tmux -S "$socket" list-sessions \
    -F '#{session_name}:#{session_windows}')
[ "$state" = work:2 ]
printf 'session state: %s\n' "$state"
second_pid=$(tmux -S "$socket" display-message -p '#{pid}')
[ "$first_pid" = "$second_pid" ]
printf 'server PID unchanged\n'
clients=$(tmux -S "$socket" list-clients -F '#{client_name}')
[ -z "$clients" ]
printf 'attached clients: 0\n'
```

Run the saved script:

```console
$ sh architecture.sh
```

The output is `session state: work:2`, `server PID unchanged`, and
`attached clients: 0` on separate lines. The cleanup trap then stops the
private server. `list-clients` reports attached clients, including control
clients; the short-lived command clients do not remain attached.

## Follow a command

A shell invocation starts a client for the selected socket. The server
executes tmux commands through command queues. The example groups
[`new-session`](/tmux/latest/manual/new-session/) and
[`new-window`](/tmux/latest/manual/new-window/) with an escaped `;`, so the
shell passes the separator to tmux. Commands within the group run in order.
Some commands pause a queue while they wait for their task.

A group is not a transaction. A command failure can stop later commands while
earlier changes remain. [Command failures](../errors-and-exceptions/) shows
a complete partial-work example. [Control mode](/concepts/transports/)
explains persistent clients, reply boundaries, and asynchronous events.

## Read state through native commands

[`list-sessions`](/tmux/latest/manual/list-sessions/),
[`list-windows`](/tmux/latest/manual/list-windows/), and
[`list-panes`](/tmux/latest/manual/list-panes/) read the current object state.
[`display-message`](/tmux/latest/manual/display-message/) evaluates a format
for a selected target. `-F` formats choose fields; `-f` filters can reduce a
listing to matching rows.

Separate reads can observe changes made by other clients. Saving output
creates a local record of that read, rather than a reservation on the objects.
[Filtering and queries](/concepts/queries/) covers live listings, and
[the object hierarchy](/concepts/server-session-window-pane/) covers IDs and
window links.

<a id="a-generated-data-table-under-a-hand-written-surface"></a>

## Source and command contracts

The [CLI manual](/tmux/latest/manual/) documents command syntax and observable
behavior for the selected release. The [C source reference](/tmux/latest/reference/)
exposes tmux's native implementation. Use those sources when a script depends
on version-specific flags, queue behavior, or formats.

Keep server selection explicit when a program manages more than one socket.
[Socket and servers](../socket-and-servers/) explains selection and server
replacement; [ownership and cleanup](../context-managers/) explains which
kill command matches the resource a script created.

The pinned
[tmux manual](https://github.com/tmux/tmux/blob/79072dd1a9f5fb437a5859e362a496fd57ec0981/tmux.1)
documents the commands and formats used here.
