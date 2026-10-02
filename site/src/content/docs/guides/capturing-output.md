---
supportedPorts: []
title: Capturing output
description: Capture a tmux pane screen or include its scrollback history.
sidebar:
  label: Capturing output
  group: Guides
  order: 5
tableOfContents: true
---

`capture-pane -p` prints a pane's visible screen. Add `-S -` to start at the oldest
line still present in its scrollback history. Capture is a snapshot of terminal
state; it is not a log of every byte the application wrote.

## Visible pane vs. scrollback

This example forces output into scrollback: it prints 40 numbered lines in a
pane with 10 rows. A normal capture shows the last screenful. Adding `-S -`
also retrieves earlier lines, including `row-1`.

Save the script as `history.sh`. It needs tmux 3.2a or newer, a POSIX shell and
fractional `sleep` support.

```sh title="history.sh"
#!/bin/sh
set -eu
directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-guide.XXXXXX")
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

tmux -S "$socket" -f /dev/null new-session -d -s capture -x 80 -y 10 \
    'i=1; while [ "$i" -le 40 ]; do printf "row-%s\n" "$i"; i=$((i + 1)); done; exec cat'
tmux -S "$socket" resize-window -t capture:0 -x 80 -y 10

attempt=0
while [ "$attempt" -lt 100 ]; do
    screen=$(tmux -S "$socket" capture-pane -p -t capture:0.0)
    if printf '%s\n' "$screen" | grep -Fqx 'row-40'; then
        printf 'Visible screen:\n%s\n' "$screen"
        printf '\nScreen and scrollback:\n'
        tmux -S "$socket" capture-pane -p -S - -t capture:0.0
        exit 0
    fi
    attempt=$((attempt + 1))
    sleep 0.05
done
printf '%s\n' 'Timed out waiting for pane output.' >&2
exit 1
```

Run the saved script:

```console
$ sh history.sh
```

`row-1` appears in the history capture but has already scrolled off the visible
screen. `row-40` appears in both. The script cleans up its private server after
printing or after any failure.

A numeric `-S` chooses a starting row: `0` is the top visible row and negative
values reach into history. `-E` selects the final row. `-J` joins wrapped rows;
`-e` includes terminal escape sequences for attributes such as color. History
is bounded by `history-limit`, so discarded lines cannot be recovered by capture.

<a id="dont-poll-wait-for-the-text-instead"></a>

## Wait for the expected text

Wait for an observable result with a deadline. An immediate capture after
[Sending keys](../sending-keys/) can race the application. Match a complete
output line, as [Capture pane output](/examples/capture-pane-output/) does, to
avoid treating an echoed command as completed work.

A screen may change before the next capture. For continuously consumed output,
use a pipe or an attached control-mode client's output events; see
[Control mode vs one-shot](/concepts/transports/).

<a id="when-the-pane-can-announce-itself-wait-for-not-scraping"></a>

## Wait for a completion signal

A program that controls its own completion can send `wait-for -S` on a dedicated
tmux channel. A matching `wait-for` waits on that server. Use the same socket
and a distinct channel for each task, and put a deadline around the wait.
[Waiting and retrying](/topics/waiting-and-retry/) covers the channel protocol.

<a id="where-to-go-next"></a>

## Use a language library

The port dropdown opens that language's capture guide. Complete programs with
imports and setup are available here:

[Python](/py/latest/examples/capture-pane-output/) ·
[TypeScript](/ts/latest/examples/capture-pane-output/) ·
[Go](/go/latest/examples/capture-pane-output/) ·
[Rust](/rs/latest/examples/capture-pane-output/) ·
[Java](/java/latest/examples/capture-pane-output/) ·
[Kotlin](/kotlin/latest/examples/capture-pane-output/) ·
[Scala](/scala/latest/examples/capture-pane-output/) ·
[.NET](/dotnet/latest/examples/capture-pane-output/) ·
[F#](/fsharp/latest/examples/capture-pane-output/) ·
[C++](/cxx/latest/examples/capture-pane-output/) ·
[Swift](/swift/latest/examples/capture-pane-output/) ·
[Ruby](/ruby/latest/examples/capture-pane-output/) ·
[Lua](/lua/latest/examples/capture-pane-output/)

## tmux reference

The [capture-pane reference](/tmux/latest/reference/capture-pane/) documents
line ranges, scrollback, and output flags for each supported tmux version.
See [wait-for](/tmux/latest/reference/wait-for/) for completion channels.

The [tmux manual](https://github.com/tmux/tmux/blob/94796f6b1182507efac8a272fc309a79e22e58a5/tmux.1)
documents these commands and their flags.
