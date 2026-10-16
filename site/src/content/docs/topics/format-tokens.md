---
supportedPorts: []
title: Format-token fields
description: Read native tmux fields with formats, choose their object context, and handle empty expansions.
sidebar:
  label: Format-token fields
  group: Topics
  order: 7
tableOfContents: true
---

A tmux format expands fields such as `#{session_name}`, `#{window_name}`, and
`#{pane_id}` in the context of a session, window, pane, or client. Use
[`display-message -p`](/tmux/latest/manual/display-message/) to print one
expansion and listing commands' `-F` flag to choose fields for each row.

## Read fields from a pane

Save this complete script as `formats.sh`. It requires tmux 3.2a or newer and
a POSIX shell. It reads the context of a private pane, evaluates a conditional,
and checks the format inventory before cleaning up.

```sh title="formats.sh"
#!/bin/sh
set -eu
directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-formats.XXXXXX")
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
    -F '#{pane_id}' -s work -n main 'cat')
state=$(tmux -S "$socket" display-message -p -t "$pane" \
    '#{session_name}:#{window_name}:#{?pane_active,active,inactive}')
[ "$state" = work:main:active ]
printf '%s\n' "$state"

missing=$(tmux -S "$socket" display-message -p -t "$pane" \
    '#{?libtmux_missing_format,present,absent}')
[ "$missing" = absent ]
printf 'unknown format: %s\n' "$missing"

tmux -S "$socket" display-message -a -t "$pane" > "$directory/formats.txt"
grep -Fx "pane_id=$pane" "$directory/formats.txt" > /dev/null
printf 'pane format inventory checked\n'
```

Run the saved script:

```console
$ sh formats.sh
```

The output is `work:main:active`, `unknown format: absent`, and
`pane format inventory checked` on separate lines.

## Choose the context

A pane target supplies its window and session context too. In the example,
`-t "$pane"` makes `session_name`, `window_name`, and `pane_active` refer to
that pane's context. A linked window can belong to more than one session;
choose a session-scoped listing when that distinction matters.

[`list-sessions`](/tmux/latest/manual/list-sessions/),
[`list-windows`](/tmux/latest/manual/list-windows/), and
[`list-panes`](/tmux/latest/manual/list-panes/) evaluate `-F` for every row.
The [query concept](/concepts/queries/) explains their scopes and `-f` filters.

## Handle empty values and version differences

An unknown variable expands to an empty string. A known field may also be
empty because the selected object has no value for it. Empty text therefore
does not identify one specific cause. Verify the variable's spelling, the
target context, and the installed tmux version.

`#{?condition,yes,no}` chooses one branch. An empty string and `0` are false;
other expanded values are true. The example's deliberately unknown variable
therefore chooses `absent`. The
[format reference](/tmux/latest/manual/full/#FORMATS) lists the variables and
operators for each documented tmux release.

## Inspect expansions

`display-message -a` prints available variables and values. Use `-v` to trace
format expansion when diagnosing a nested expression. Keep shell-facing
formats in single quotes so the shell passes them intact to tmux.

`-F` controls presentation; it does not escape arbitrary field values for
JSON, CSV, or a shell. Use IDs when a script needs simple stable tokens, and
choose an explicit encoding for unrestricted names or paths. Treat each
listing as a current read; run it again when fresh state is required.

The pinned
[tmux manual](https://github.com/tmux/tmux/blob/e476c1230b958df0cb12977517d24b3dc931375b/tmux.1)
documents the commands and formats used here.
