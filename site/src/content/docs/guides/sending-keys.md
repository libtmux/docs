---
supportedPorts: []
title: Sending keys
description: Send literal text or named keys to a tmux pane and distinguish input from completion.
sidebar:
  label: Sending keys
  group: Guides
  order: 4
tableOfContents: true
---

`send-keys -l` types literal characters. Without `-l`, tmux recognizes key names
such as `Enter`, `C-c`, and `Up`. Typing the word `Enter` and pressing Enter are
separate operations.

## Literal text, key names, and whether Enter follows

This complete script types the word `Enter` into a pane running `cat`, then
presses the Enter key. Neither command starts an interactive tmux client.
Save it as `send.sh` and run it in a POSIX shell with tmux 3.2a or newer and
fractional `sleep` support.

```sh title="send.sh"
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

tmux -S "$socket" -f /dev/null new-session -d -s input 'cat'
tmux -S "$socket" send-keys -t input:0.0 -l 'Enter'
tmux -S "$socket" send-keys -t input:0.0 Enter

attempt=0
while [ "$attempt" -lt 100 ]; do
    screen=$(tmux -S "$socket" capture-pane -p -t input:0.0)
    if printf '%s\n' "$screen" | grep -Fqx 'Enter'; then
        printf '%s\n' "$screen"
        exit 0
    fi
    attempt=$((attempt + 1))
    sleep 0.05
done
printf '%s\n' 'Timed out waiting for typed input.' >&2
exit 1
```

Run the saved script:

```console
$ sh send.sh
```

The screen contains `Enter`: the terminal echoes the input, and `cat` writes it
back after the newline. The polling loop waits for visible text and fails after
100 unsuccessful checks. Cleanup stops only the private server.

Literal input disables tmux's key-name lookup. The application still interprets
those characters. In a shell pane, that includes shell quoting, expansions and
commands; literal mode does not make shell input safe to compose from arbitrary
text.

## The race you can't see from the call site

Completing `send-keys` means tmux accepted the input. It does not establish that
the application read it or finished a command. Terminal echo can appear before
the application processes a line.

For a shell command, wait for its distinct output or a completion signal before
using the result. [Capture pane output](/examples/capture-pane-output/) matches
a complete output line so the echoed command cannot satisfy the check.
[Capturing output](../capturing-output/) explains screen and history capture.

<a id="where-to-go-next"></a>

## Use a language library

Each port's complete capture program sends a command, waits for its output and
cleans up. Use the port dropdown for its input APIs, or open the program:

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

The [send-keys reference](/tmux/latest/reference/send-keys/) describes literal
input, key names, and each supported flag. Select your installed tmux version
on that page.

The [tmux manual](https://github.com/tmux/tmux/blob/94796f6b1182507efac8a272fc309a79e22e58a5/tmux.1)
documents these commands and their flags.
