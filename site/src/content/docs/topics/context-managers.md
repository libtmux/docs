---
supportedPorts: []
title: Ownership and cleanup
description: Remove owned native tmux objects with explicit kill commands and shell cleanup traps.
sidebar:
  label: Ownership and cleanup
  group: Topics
  order: 4
tableOfContents: true
---

A tmux session, window, or pane remains until its lifecycle or an explicit
command removes it. A shell script exiting does not normally remove the
objects it created. Register cleanup after creating private resources and
keep the cleanup target tied to those resources.

## Remove the object you own

[`kill-pane`](/tmux/latest/manual/kill-pane/) destroys one pane and its process.
[`kill-window`](/tmux/latest/manual/kill-window/) destroys the window, all its
panes, and every session link to that window.
[`kill-session`](/tmux/latest/manual/kill-session/) destroys the session and
its window links. A window linked to another surviving session can remain.

Save this complete script as `cleanup.sh`. It requires tmux 3.2a or newer and
a POSIX shell. It removes a temporary pane, window, and session while keeping
an independent session on the same private server.

```sh title="cleanup.sh"
#!/bin/sh
set -eu
directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-cleanup.XXXXXX")
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

tmux -S "$socket" -f /dev/null new-session -d -s keep -n main 'cat'
window=$(tmux -S "$socket" new-window -d -P \
    -F '#{window_id}' -t '=keep:' -n temporary 'cat')
pane=$(tmux -S "$socket" split-window -d -P \
    -F '#{pane_id}' -t "$window" 'cat')
tmux -S "$socket" kill-pane -t "$pane"
count=$(tmux -S "$socket" list-panes -t "$window" -F '#{pane_id}' | wc -l)
[ "$count" -eq 1 ]
printf 'temporary pane removed\n'

tmux -S "$socket" kill-window -t "$window"
windows=$(tmux -S "$socket" list-windows -t '=keep' -F '#{window_name}')
[ "$windows" = main ]
printf 'temporary window removed\n'

tmux -S "$socket" new-session -d -s temporary 'cat'
tmux -S "$socket" kill-session -t '=temporary'
if tmux -S "$socket" has-session -t '=temporary' 2>/dev/null; then
    printf 'Temporary session survived cleanup\n' >&2
    exit 1
fi
tmux -S "$socket" has-session -t '=keep'
printf 'temporary session removed; keep remains\n'
```

Run the saved script:

```console
$ sh cleanup.sh
```

The output is `temporary pane removed`, `temporary window removed`, and
`temporary session removed; keep remains` on separate lines. The final trap
then stops the private server and the `keep` session too.

## Preserve failures during cleanup

The trap saves the script's status before running cleanup. A failed operation
therefore still makes the script fail after successful cleanup. If
[`kill-server`](/tmux/latest/manual/kill-server/) fails, the trap reports the
private directory and keeps it available for inspection instead of removing
the address of a potentially running server.

The trap handles normal shell exit and the listed signals. It cannot handle
an uncatchable termination such as `SIGKILL`. Keep private socket directories
identifiable when a surrounding test runner must recover from that case.

## Shared windows and shared servers

Destroying a window also affects sessions that link to it. Use
[`unlink-window`](/tmux/latest/manual/unlink-window/) when you own only one
session's link; removing the last link has separate `-k` behavior.
[The object hierarchy](/concepts/server-session-window-pane/) explains window
identity and links.

A server-wide kill is appropriate for a server created on a private socket.
For an existing shared server, retain the IDs of the objects the script
created and clean up those objects. The [isolated test guide](/guides/testing-with-libtmux/)
shows a complete private-server fixture.

The pinned
[tmux manual](https://github.com/tmux/tmux/blob/e476c1230b958df0cb12977517d24b3dc931375b/tmux.1)
documents the commands and formats used here.
