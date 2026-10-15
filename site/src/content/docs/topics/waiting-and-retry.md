---
supportedPorts: []
title: Waiting and retrying
description: Coordinate native tmux commands with wait-for channels, bounded waits, and state checks before retries.
sidebar:
  label: Waiting and retrying
  group: Topics
  order: 8
tableOfContents: true
---

Wait for the state your next command needs. A successful input command does
not establish that a pane's application finished. Use a named
[`wait-for`](/tmux/latest/manual/wait-for/) signal when the program can
cooperate, or poll an observable condition with a deadline.

## Signal completion and bound the wait

Save this complete script as `waiting.sh`. It requires tmux 3.2a or newer,
a POSIX shell, and the GNU coreutils `timeout` command. It starts a producer
on a private server, waits for its signal, checks a deadline, and releases
a cooperative lock before cleanup.

```sh title="waiting.sh"
#!/bin/sh
set -eu
directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-waiting.XXXXXX")
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

tmux -S "$socket" -f /dev/null new-session -d -s work 'cat'
tmux -S "$socket" new-window -d -t '=work:' -n build \
    -e "DEMO_SOCKET=$socket" -e "RESULT=$directory/built.txt" \
    'printf "build completed\n" > "$RESULT"; tmux -S "$DEMO_SOCKET" wait-for -S built; exec cat'
timeout 5 tmux -S "$socket" wait-for built
[ "$(cat "$directory/built.txt")" = 'build completed' ]
printf 'build completed\n'

if timeout 1 tmux -S "$socket" wait-for never-signalled; then
    printf 'An unsignalled channel unexpectedly completed\n' >&2
    exit 1
else
    status=$?
    [ "$status" -eq 124 ]
fi
printf 'unsignalled channel reached deadline\n'

timeout 5 tmux -S "$socket" wait-for -L layout-lock
tmux -S "$socket" wait-for -U layout-lock
printf 'lock released\n'
```

Run the saved script:

```console
$ sh waiting.sh
```

The output is `build completed`, `unsignalled channel reached deadline`, and
`lock released` on separate lines. The producer writes its result before
signaling. The deliberately unsignalled channel verifies that the shell
recognizes GNU `timeout`'s exit status 124.

## Name the channel and choose its meaning

`wait-for channel` waits for a signal. `wait-for -S channel` signals that name.
Both commands must reach the same server. Channel names are server-wide;
two sessions do not provide separate channel namespaces. Use a private
server or a job-specific name when independent tasks could collide.

The signal says that the producer reached its signaling step. It carries no
result text and does not prove that an arbitrary command succeeded. Check
the operation's result, write it before signaling, and keep errors visible.
The [capture example](/examples/capture-pane-output/) uses a completion
signal with pane output.

## Timeouts and retries

`wait-for` has no native timeout flag. This script uses GNU `timeout` to bound
its waiting client. A deadline ending the client does not roll back server
state or stop a separate producer. Read the required state before deciding
whether to retry a mutation such as
[`new-window`](/tmux/latest/manual/new-window/).

For output conditions, a bounded loop around
[`capture-pane`](/tmux/latest/manual/capture-pane/) can wait for a specific
result. Match output that cannot be satisfied by the echoed input command.
[Pane interaction](../pane-interaction/#waiting-for-something-to-finish)
shows a complete example with a fixed attempt count.

## Cooperative locks

`wait-for -L name` acquires a named lock, waiting while it is held.
`wait-for -U name` releases it. Every cooperating caller must use the same
name and server. The lock coordinates those callers; it does not make a
group of tmux mutations atomic or undo changes on failure.

Arrange release on every exit path when a shared server owns the lock.
The example's final cleanup stops its entire private server, including any
remaining channels. [Command failures](../errors-and-exceptions/) explains
how command errors and partial work affect retries.

The pinned
[tmux manual](https://github.com/tmux/tmux/blob/79072dd1a9f5fb437a5859e362a496fd57ec0981/tmux.1)
documents the commands and formats used here.
