---
supportedPorts: []
title: Capture pane output
description: Capture a tmux pane's screen and wait for a complete output line.
sidebar:
  label: Capture pane output
  group: Examples
  order: 3
tableOfContents: true
---

`capture-pane -p` prints a pane's visible screen. Sending a command and reading
its result are separate operations: the pane's shell may still be processing
input when the first capture runs.

## Read what's on screen

This complete shell program starts a private tmux server, sends a command, and
captures until the expected line appears. It removes the server on exit and
fails after 100 unsuccessful checks with 50-millisecond pauses.

Save it as `capture.sh` and run `sh capture.sh`, or paste the whole block into
a POSIX shell. It requires tmux 3.2 or newer and `sleep` with fractional seconds.

```sh title="capture.sh"
(
    set -eu
    directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-capture.XXXXXX")
    socket="$directory/tmux.sock"

    cleanup() {
        status=$?
        trap - EXIT
        if [ -S "$socket" ] && ! tmux -S "$socket" kill-server; then
            printf '%s\n' "Cannot stop tmux; kept $directory." >&2
            exit 1
        fi
        rm -rf "$directory" || status=$?
        exit "$status"
    }
    trap cleanup EXIT
    trap 'exit 1' HUP INT TERM

    tmux -S "$socket" -f /dev/null new-session -d -s capture \
        -e ENV=/dev/null 'sh'
    tmux -S "$socket" send-keys -t capture:0.0 -l \
        "printf '\\nlibtmux capture ready\\n'"
    tmux -S "$socket" send-keys -t capture:0.0 Enter

    attempt=0
    while [ "$attempt" -lt 100 ]; do
        screen=$(tmux -S "$socket" capture-pane -p -t capture:0.0)
        if printf '%s\n' "$screen" | grep -Fqx 'libtmux capture ready'; then
            printf '%s\n' "$screen"
            exit 0
        fi
        attempt=$((attempt + 1))
        sleep 0.05
    done
    printf '%s\n' 'Timed out waiting for captured output.' >&2
    exit 1
)
```

Cleanup also runs if startup fails after creating the server. If tmux cannot
be stopped, the script reports the error and keeps its socket directory so
you can inspect or stop that server.

<a id="wait-for-text-instead-of-guessing-a-delay"></a>

## Wait for output or completion

The leading newline puts the output on a fresh screen row even if the shell's
first prompt arrives late. `grep -Fx` matches the complete line, so the echoed
command cannot satisfy the check. The short pause limits polling; the captured
output determines when the program finishes.

Capture reads screen state, so it can miss output that has scrolled away.
[Capturing output](/guides/capturing-output/) covers history and streaming;
[Sending keys](/guides/sending-keys/) explains input and completion.

## Use a language library

Complete programs with imports, setup, and cleanup:

[Python](/py/latest/examples/capture-pane-output/) ·
[TypeScript](/ts/latest/examples/capture-pane-output/) ·
[Go](/go/latest/examples/capture-pane-output/) ·
[Rust](/rs/latest/examples/capture-pane-output/) ·
[Java](/java/latest/examples/capture-pane-output/) ·
[Kotlin](/kotlin/latest/examples/capture-pane-output/) ·
[Scala](/scala/latest/examples/capture-pane-output/) ·
[C#](/csharp/latest/examples/capture-pane-output/) ·
[F#](/fsharp/latest/examples/capture-pane-output/) ·
[C++](/cxx/latest/examples/capture-pane-output/) ·
[Swift](/swift/latest/examples/capture-pane-output/) ·
[Ruby](/ruby/latest/examples/capture-pane-output/) ·
[Lua](/lua/latest/examples/capture-pane-output/)

<a id="source-inclusion"></a>
<a id="where-this-comes-from"></a>

The [tmux manual source](https://github.com/tmux/tmux/blob/94796f6b1182507efac8a272fc309a79e22e58a5/tmux.1)
describes `capture-pane`, `send-keys`, and `kill-server`.
