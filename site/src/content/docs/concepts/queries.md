---
supportedPorts: []
title: Filtering and queries
description: Select tmux sessions, windows, and panes with native format filters and exact targets.
sidebar:
  label: Filtering and queries
  group: Concepts
  order: 4
tableOfContents: true
---

Use [`list-sessions`](/tmux/latest/manual/list-sessions/),
[`list-windows`](/tmux/latest/manual/list-windows/), and
[`list-panes`](/tmux/latest/manual/list-panes/) to query a running tmux server.
Their `-f` flag selects rows with a boolean format expression. Their `-F` flag
chooses the fields printed in each row. A listing can return zero, one, or many
rows; an empty listing is a successful command.

## Match names and choose fields

Save this complete script as `queries.sh`. It requires tmux 3.2a or newer and
a POSIX shell. It creates a private server, runs the queries, and stops that
server on exit.

```sh title="queries.sh"
#!/bin/sh
set -eu
directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-query.XXXXXX")
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
tmux -S "$socket" new-session -d -s worker -n editor 'cat'
tmux -S "$socket" new-window -d -t '=work:' -n logs 'cat'

exact=$(tmux -S "$socket" list-sessions \
    -f '#{==:#{session_name},work}' -F '#{session_name}')
[ "$exact" = work ]
printf 'exact: %s\n' "$exact"

casefold=$(tmux -S "$socket" list-sessions \
    -f '#{m/i:WORK,#{session_name}}' -F '#{session_name}')
[ "$casefold" = work ]
printf 'case insensitive: %s\n' "$casefold"

windows=$(tmux -S "$socket" list-windows -t '=work' \
    -f '#{m/r:^edit,#{window_name}}' -F '#{session_name}:#{window_name}')
[ "$windows" = work:editor ]
printf 'regex: %s\n' "$windows"

panes=$(tmux -S "$socket" list-panes -a \
    -f '#{&&:#{==:#{session_name},work},#{pane_active}}' \
    -F '#{pane_id}')
# Pane IDs contain no whitespace; split the rows to count matches.
# shellcheck disable=SC2086
set -- $panes
[ "$#" -eq 2 ]
printf 'active panes in work: %s\n' "$#"

missing=$(tmux -S "$socket" list-sessions \
    -f '#{==:#{session_name},absent}' -F '#{session_id}')
[ -z "$missing" ]
printf 'no matching sessions\n'

tmux -S "$socket" has-session -t '=work'
if tmux -S "$socket" has-session -t '=wor' 2>/dev/null; then
    printf 'An exact target unexpectedly matched a prefix\n' >&2
    exit 1
fi
printf 'exact target checked\n'
```

Run the saved script:

```console
$ sh queries.sh
```

The output is:

```text
exact: work
case insensitive: work
regex: work:editor
active panes in work: 2
no matching sessions
exact target checked
```

`#{==:#{session_name},work}` compares the complete session name with case
sensitivity. The `m` operator uses shell patterns; its `i` modifier ignores
case. The `r` modifier selects an extended regular expression instead of a
shell pattern. `&&` requires both nested conditions to be true. Single quotes
keep the shell from interpreting the format before tmux receives it.

## Choose the listing scope

`list-sessions` lists the server's sessions. `list-windows -t '=work'` lists
windows in exactly the session named `work`; `list-windows -a` visits all
sessions. `list-panes` normally lists one window. Add `-s` to list every window
in a session, or `-a` to visit all sessions on the server.

`pane_active` identifies the active pane in each window. It does not identify
one pane for the entire server. In the script, `work` has two windows, so the
filter returns two pane IDs.

A window can be linked into more than one session. Server-wide window and pane
listings visit those links, so the same window or pane ID can appear more than
once. Keep the session fields when the link matters, or deduplicate IDs before
applying an operation once per object.

## Require one target

An exact session target begins with `=`. The
[`has-session`](/tmux/latest/manual/has-session/) command exits with zero if
that session exists and one if it does not. Without `=`, tmux can match name
prefixes or shell patterns. The [target syntax](/tmux/latest/manual/full/#COMMANDS)
describes how it resolves sessions, windows, and panes.

A filter has no exactly-one guarantee. Count the returned IDs before passing
one to the next command. The [querying guide](/guides/querying-and-filtering/)
shows that check and uses
[`display-message`](/tmux/latest/manual/display-message/) with the selected ID.
Objects can disappear between commands, so keep errors from the later command
visible too.

## Diagnose an empty result

Formats treat an empty string or `0` as false. Unknown format variables expand
to an empty string, which can make a misspelled field look like a valid query
with no matches. Inspect the same fields with `-F` before adding `-f`, and check
the [format variables and operators](/tmux/latest/manual/full/#FORMATS).

Each listing reads live server state. Saving its output lets several local
decisions use the same rows, but does not reserve the sessions, windows, or
panes. Run another listing when the decision needs fresh state.

These commands and expressions are documented in the pinned
[tmux manual](https://github.com/tmux/tmux/blob/79072dd1a9f5fb437a5859e362a496fd57ec0981/tmux.1).
