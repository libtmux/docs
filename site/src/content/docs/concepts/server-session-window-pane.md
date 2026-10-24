---
supportedPorts: []
title: Server, session, window, pane
description: Understand native tmux objects, stable IDs, window links, and attached clients.
sidebar:
  label: Server, session, window, pane
  group: Concepts
  order: 2
tableOfContents: true
---

A tmux server owns sessions, windows, and panes. A session holds links to
windows. Each window holds one or more panes, and each pane runs a process
inside a terminal. A client connects your terminal to a session.

```text
Server
├── Session
│   └── Window link
│       └── Window
│           └── Pane
└── Client attached to a session
```

Use [`new-session`](/tmux/latest/manual/new-session/) to start a session,
[`new-window`](/tmux/latest/manual/new-window/) to add a window, and
[`split-window`](/tmux/latest/manual/split-window/) to add a pane. Closing a
client leaves those objects and their processes running unless an option such
as `destroy-unattached` requests their removal.

<a id="stable-identity-not-name-or-index"></a>

## Stable identity

tmux assigns an ID when it creates a session, window, or pane. The ID stays
with that object until it is destroyed, even when its name or index changes.
A server is selected by its socket name or path.

| Object | ID prefix | Example |
| --- | --- | --- |
| Session | `$` | `$13` |
| Window | `@` | `@3243` |
| Pane | `%` | `%5433` |

Quote IDs that contain `$` when typing them in a shell. A saved ID belongs to
one server lifetime: another server using the same socket path can reuse IDs.
The [target syntax](/tmux/latest/manual/full/#COMMANDS) describes how commands
resolve IDs, names, and indexes.

Save this complete script as `hierarchy.sh`. It requires tmux 3.3a or newer
and a POSIX shell. It renames a session and a window, checks their IDs, and
links the window into another session on its private server.

```sh title="hierarchy.sh"
#!/bin/sh
set -eu
directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-hierarchy.XXXXXX")
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

pane=$(tmux -S "$socket" -f /dev/null new-session -d -P \
    -F '#{pane_id}' -s work -n editor 'cat')
session=$(tmux -S "$socket" display-message -p -t "$pane" '#{session_id}')
window=$(tmux -S "$socket" display-message -p -t "$pane" '#{window_id}')

tmux -S "$socket" rename-session -t "$session" renamed
tmux -S "$socket" rename-window -t "$window" source
names=$(tmux -S "$socket" display-message -p -t "$pane" \
    '#{session_name}:#{window_name}')
[ "$names" = renamed:source ]
printf '%s\n' "$names"
current=$(tmux -S "$socket" display-message -p -t "$pane" \
    '#{session_id} #{window_id} #{pane_id}')
[ "$current" = "$session $window $pane" ]
printf 'stable IDs preserved\n'

tmux -S "$socket" new-session -d -s other 'cat'
tmux -S "$socket" link-window -s "$window" -t '=other:1'
links=$(tmux -S "$socket" list-windows -a \
    -f "#{==:#{window_id},$window}" -F '#{window_id}')
# Window IDs contain no whitespace; each row represents one session link.
# shellcheck disable=SC2086
set -- $links
[ "$#" -eq 2 ]
[ "$1" = "$window" ] && [ "$2" = "$window" ]
printf 'shared window links: %s\n' "$#"
```

Run the saved script:

```console
$ sh hierarchy.sh
```

The output is `renamed:source`, `stable IDs preserved`, and
`shared window links: 2` on separate lines. The cleanup trap stops the private
server and removes its socket directory, including after a failed check.

## Window links and panes

[`link-window`](/tmux/latest/manual/link-window/) makes an existing window
available in another session. Both links refer to the same panes and running
programs. A pane ID identifies that pane across both sessions. Its window
index belongs to a link and can differ between sessions.

[`unlink-window`](/tmux/latest/manual/unlink-window/) removes a session's
window link. A window needs at least one link to survive; read the command's
`-k` behavior before removing the last link.
[`kill-window`](/tmux/latest/manual/kill-window/) destroys the window through
all its links. Use the smallest object that your cleanup actually owns.

<a id="client-a-view-not-a-child"></a>

## Attached clients

[`attach-session`](/tmux/latest/manual/attach-session/) connects a terminal
to a session. [`detach-client`](/tmux/latest/manual/detach-client/) releases
that client while pane processes continue. Several clients can view the same
session; [`list-clients`](/tmux/latest/manual/list-clients/) lists them.

A [control-mode connection](../transports/) is also a client. It counts toward
`session_attached` and affects options such as `destroy-unattached`. Check
those options before assuming that detaching every client leaves a session
running.

## Read current state

[`list-sessions`](/tmux/latest/manual/list-sessions/),
[`list-windows`](/tmux/latest/manual/list-windows/), and
[`list-panes`](/tmux/latest/manual/list-panes/) read current server state.
Use their `-F` formats to print IDs and the fields your task needs.
[Filtering and queries](../queries/) explains scopes, filters, and repeated
rows for shared windows. A later command can still fail if another client
removes an object after the listing.

The pinned
[tmux manual](https://github.com/tmux/tmux/blob/e476c1230b958df0cb12977517d24b3dc931375b/tmux.1)
documents the object and target behavior used here.
