---
supportedPorts: []
title: Traversal
description: List native tmux objects by scope and distinguish session links from unique window and pane IDs.
sidebar:
  label: Traversal
  group: Topics
  order: 3
tableOfContents: true
---

Choose the scope that answers your question. Native tmux can list every
session, the windows in one session, the panes in one window, or the panes
across a session or server. Print IDs with `-F` when later commands need to
address those objects.

## Read a hierarchy with a shared window

Save this complete script as `traversal.sh`. It requires tmux 3.2a or newer
and a POSIX shell. It creates a shared window on a private server and checks
both listing-row counts and unique pane counts.

```sh title="traversal.sh"
#!/bin/sh
set -eu
directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-traversal.XXXXXX")
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

tmux -S "$socket" -f /dev/null new-session -d -s work -n editor 'cat'
tmux -S "$socket" split-window -d -t '=work:editor' 'cat'
tmux -S "$socket" new-window -d -t '=work:' -n logs 'cat'
tmux -S "$socket" new-session -d -s other -n main 'cat'
tmux -S "$socket" link-window -s '=work:editor' -t '=other:1'

windows=$(tmux -S "$socket" list-windows -t '=work' -F '#{window_id}')
# IDs contain no whitespace; splitting rows lets the script count them.
# shellcheck disable=SC2086
set -- $windows
[ "$#" -eq 2 ]
printf 'work windows: %s\n' "$#"
panes=$(tmux -S "$socket" list-panes -s -t '=work' -F '#{pane_id}')
# shellcheck disable=SC2086
set -- $panes
[ "$#" -eq 3 ]
printf 'work panes: %s\n' "$#"

rows=$(tmux -S "$socket" list-panes -a -F '#{pane_id}')
# shellcheck disable=SC2086
set -- $rows
[ "$#" -eq 6 ]
printf 'server pane rows: %s\n' "$#"
unique=$(printf '%s\n' "$rows" | sort -u)
# shellcheck disable=SC2086
set -- $unique
[ "$#" -eq 4 ]
printf 'unique server panes: %s\n' "$#"
```

Run the saved script:

```console
$ sh traversal.sh
```

The output is `work windows: 2`, `work panes: 3`, `server pane rows: 6`, and
`unique server panes: 4` on separate lines. The two editor panes appear once
through each session's link to their window. The final cleanup stops the
private server and its pane processes.

## Select the listing scope

[`list-sessions`](/tmux/latest/manual/list-sessions/) lists the server's
sessions. [`list-windows -t session`](/tmux/latest/manual/list-windows/)
lists windows in that session; `-a` lists windows through all sessions.
[`list-panes`](/tmux/latest/manual/list-panes/) normally lists one window.
Use `-s -t session` for every window in that session, or `-a` for every
session on the selected server.

Explicit targets make the intended context visible. A session target can use
`=name` for an exact name. For commands that accept a window or pane target,
include its session and separators, such as `=work:editor`. The
[target syntax](/tmux/latest/manual/full/#COMMANDS) describes the supported
forms and inference rules.

## Count links and objects separately

[`link-window`](/tmux/latest/manual/link-window/) adds another session link
to the same window. Its window and pane IDs remain unchanged. A server-wide
listing therefore can contain several rows for one ID.

Keep `session_id` and `window_index` when the question concerns a session's
window links. Deduplicate `window_id` or `pane_id` when an operation should
run once per object. The example can split its output into shell words
because these IDs contain no whitespace; unrestricted names need a different
encoding.

## Filter and refresh deliberately

A listing is a read of current state. It does not reserve the returned
objects, and separate reads can observe changes from other clients. Pass
a known ID to [`display-message`](/tmux/latest/manual/display-message/) or
a mutation rather than repeating name matching when identity matters.

[Filtering and queries](/concepts/queries/) covers `-f` expressions and
result-count checks. [The object hierarchy](/concepts/server-session-window-pane/)
explains ID lifetimes, and [command failures](../errors-and-exceptions/)
covers objects disappearing between commands.

The pinned
[tmux manual](https://github.com/tmux/tmux/blob/79072dd1a9f5fb437a5859e362a496fd57ec0981/tmux.1)
documents the commands and formats used here.
