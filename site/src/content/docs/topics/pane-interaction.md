---
supportedPorts: []
title: Pane interaction
description: Send native tmux input, capture a pane screen or scrollback, and wait for an output condition.
sidebar:
  label: Pane interaction
  group: Topics
  order: 5
tableOfContents: true
---

[`send-keys`](/tmux/latest/manual/send-keys/) sends text or key names to a
pane's terminal. [`capture-pane`](/tmux/latest/manual/capture-pane/) reads
its screen and scrollback. Choose the pane explicitly and treat sending input
and observing its result as separate operations.

## Send a command and capture its result

Save this complete script as `pane-io.sh`. It requires tmux 3.2a or newer and
a POSIX shell. It starts a shell with an empty prompt, sends a command, polls
for both result lines, and cleans up its private server.

```sh title="pane-io.sh"
#!/bin/sh
set -eu
directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-pane-io.XXXXXX")
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
    -e PS1= -F '#{pane_id}' -s work -n main 'sh')
tmux -S "$socket" send-keys -l -t "$pane" "printf 'first line\\nsecond line\\n'"
tmux -S "$socket" send-keys -t "$pane" Enter
ready=no
for attempt in 1 2 3 4 5; do
    tmux -S "$socket" capture-pane -p -J -S - -t "$pane" \
        > "$directory/screen.txt"
    sed 's/[[:blank:]]*$//' "$directory/screen.txt" > "$directory/lines.txt"
    if grep -Fx 'first line' "$directory/lines.txt" > /dev/null && \
        grep -Fx 'second line' "$directory/lines.txt" > /dev/null; then
        ready=yes
        break
    fi
    if [ "$attempt" -lt 5 ]; then
        sleep 1
    fi
done
[ "$ready" = yes ]
printf 'first line\nsecond line\n'
```

Run the saved script:

```console
$ sh pane-io.sh
```

The output is `first line` followed by `second line`. The capture checks match
whole result lines so the echoed command cannot satisfy them. The loop makes
at most five attempts with one second between unsuccessful attempts. `-J`
preserves trailing spaces, so the text-only checks remove those spaces from
a separate copy of the captured lines.

## Literal input and named keys

`send-keys -l` treats its arguments as literal text. Without `-l`, tmux
recognizes key names such as `Enter`, `C-c`, and `Up`. Shell quoting protects
an argument from the shell; `-l` controls how tmux interprets it. The script
sends literal command text first and the `Enter` key separately.

The [sending keys guide](/guides/sending-keys/) explains literal key names
and Enter. A pane can also be in a mode such as copy mode, where keys act on
that mode rather than reaching the application; choose the pane's input
state deliberately.

## Capture range and representation

`capture-pane -p` prints the capture. With no range, it captures the visible
screen. `-S -` starts at the oldest available history line, and `-J` joins
wrapped lines. History is bounded by tmux configuration, so old output may
already have been discarded. `-a` selects the alternate screen when it exists;
that screen has no scrollback history.

A capture is terminal state, including prompts, echoed input, cursor updates,
and full-screen redraws. It is not an application's original stdout stream.
For ongoing pane output, inspect
[`pipe-pane`](/tmux/latest/manual/pipe-pane/) and choose when recording begins.
The [capture guide](/guides/capturing-output/) covers ranges and formatting.

<a id="waiting-for-something-to-finish"></a>

## Wait for the required state

A successful `send-keys` command means tmux handled the input. The application
may still be processing it. Poll for a specific result when that is the
observable condition your script needs. Match the result rather than text
that can appear in the command echo.

When the program can cooperate, it can signal a named
[`wait-for`](/tmux/latest/manual/wait-for/) channel. The
[waiting topic](../waiting-and-retry/) explains signaling and time limits.
An object can disappear between input and capture, so keep errors visible
and run cleanup on failed paths too.

The pinned
[tmux manual](https://github.com/tmux/tmux/blob/79072dd1a9f5fb437a5859e362a496fd57ec0981/tmux.1)
documents the commands and formats used here.
