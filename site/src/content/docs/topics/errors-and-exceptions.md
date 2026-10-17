---
supportedPorts: []
title: Command failures
description: Inspect native tmux exit status and error output, recognize partial command groups, and check state before retrying.
sidebar:
  label: Command failures
  group: Topics
  order: 11
tableOfContents: true
---

Check a tmux client's exit status and preserve its standard error. A missing
target, unsupported flag, command error, or connection failure can require
different recovery. An expected negative answer, such as an absent session,
can be handled as a branch in a shell script.

## Check absence and partial work

Save this complete script as `failures.sh`. It requires tmux 3.3a or newer
and a POSIX shell. It checks a missing session, deliberately fails a grouped
command, and inspects what remains on its private server.

```sh title="failures.sh"
#!/bin/sh
set -eu
directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-failures.XXXXXX")
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
if tmux -S "$socket" has-session -t '=missing' \
    > "$directory/stdout.txt" 2> "$directory/stderr.txt"; then
    printf 'Missing session unexpectedly exists\n' >&2
    exit 1
else
    status=$?
    [ "$status" -eq 1 ]
fi
[ ! -s "$directory/stdout.txt" ] && [ -s "$directory/stderr.txt" ]
printf 'missing session returned 1\n'

if tmux -S "$socket" \
    new-window -d -t '=work:' -n before 'cat' \; \
    select-window -t '=missing:bad' \; \
    new-window -d -t '=work:' -n after 'cat' \
    > "$directory/stdout.txt" 2> "$directory/stderr.txt"; then
    printf 'Invalid target unexpectedly succeeded\n' >&2
    exit 1
else
    status=$?
    [ "$status" -eq 1 ]
fi
windows=$(tmux -S "$socket" list-windows -t '=work' -F '#{window_name}')
[ "$windows" = "$(printf 'main\nbefore')" ]
printf 'partial work remains: main,before\n'
[ -s "$directory/stderr.txt" ]
printf 'error preserved on stderr\n'
```

Run the saved script:

```console
$ sh failures.sh
```

The output is `missing session returned 1`,
`partial work remains: main,before`, and `error preserved on stderr` on
separate lines. The `before` window survives the group's error; the later
`after` window was never created. Cleanup still removes the private server.

## Separate results from diagnostics

[`has-session`](/tmux/latest/manual/has-session/) exits with zero when the
selected session exists and one when it does not. The example records that
status immediately in the `else` branch. A missing server is also an error,
so keep the diagnostic when the distinction matters.

Commands such as [`list-windows`](/tmux/latest/manual/list-windows/) and
[`capture-pane -p`](/tmux/latest/manual/capture-pane/) print results on
standard output. Capturing standard error separately keeps diagnostics out
of data that a script parses. Preserve a failed command's status before
running a later command that changes `$?`.

## Inspect partial mutations before retrying

Commands separated with a tmux `;` run in a group. A command error stops
subsequent commands in that group, and earlier mutations remain. The
[command syntax](/tmux/latest/manual/full/#COMMANDS) documents those queues.
The example's [`select-window`](/tmux/latest/manual/select-window/) fails
after the first [`new-window`](/tmux/latest/manual/new-window/) succeeds.

After a timeout or lost connection, a mutation may already have reached the
server. Re-read the required state before retrying. Use exact targets and
retained IDs to recognize objects created by the operation. A pre-check and
a later mutation are separate commands, so another client can change state
between them.

## Distinguish tmux completion from application completion

[`send-keys`](/tmux/latest/manual/send-keys/) succeeding reports that tmux
handled the input; it does not report the pane application's exit status.
A background task also needs its own completion and error reporting.
[Waiting and retrying](../waiting-and-retry/) covers bounded waits and
completion signals. [Ownership and cleanup](../context-managers/) shows how
a shell trap preserves operation failures during teardown.

The pinned
[tmux manual](https://github.com/tmux/tmux/blob/e476c1230b958df0cb12977517d24b3dc931375b/tmux.1)
documents the commands and formats used here.
