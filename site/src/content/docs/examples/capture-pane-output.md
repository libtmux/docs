---
supportedPorts: []
title: Capture pane output
description: Build a script that sends a command, captures a tmux pane's screen, and waits for a complete output line.
sidebar:
  label: Capture pane output
  group: Examples
  order: 3
tableOfContents: true
---

`capture-pane -p` prints a pane's visible screen. Sending a command and reading
its result are separate operations: the pane's shell may still be processing
input when the first capture runs. The steps below build `capture.sh` around
that gap. It sends a command, captures the screen until one complete line
appears, and removes its server. [The complete script](#the-complete-script)
follows the last step. It requires tmux 3.3a or newer and `sleep` with
fractional seconds.

## 1. Choose a private socket

Like the [attach example](/examples/attach-and-send-keys/), the script puts
its server's socket in a fresh directory. A command that names that socket
reaches only that server, never the one you already use.

```sh excerpt="capture.sh" from='directory=$(mktemp' to="tmux.sock"
```

## 2. Start a detached session

`new-session -d` creates a session without attaching a terminal. `-f /dev/null`
keeps your `tmux.conf` out of the private server, `-s capture` names the
session, and `'sh'` is the program in its pane.

```sh excerpt="capture.sh" from="new-session -d" to="'sh'"
```

`-e ENV=/dev/null` stops `sh` from loading a startup file, so nothing but the
command's own output reaches the screen. The command returns once the session
exists.

## 3. Type a command that starts on a fresh row

`send-keys -l` types its argument literally. The target `capture:0.0` reads as
session `capture`, window `0`, pane `0`. A new session has exactly one of each,
and its server holds no other session, so the bare name is unambiguous. Use
`=capture` on a server that may hold others.

```sh excerpt="capture.sh" from="capture:0.0 -l" to="libtmux capture ready"
```

The leading `\n` in the `printf` format puts the output on a fresh row even
if the shell's first prompt arrives late.

## 4. Press Enter

Without `-l`, `send-keys` reads `Enter` as the `Enter` key, so the shell runs
the text from step 3.

```sh excerpt="capture.sh" from="capture:0.0 Enter"
```

## 5. Read the screen

`capture-pane -p` prints the pane's visible rows to standard output, and
`$(...)` stores them in `screen`.

```sh excerpt="capture.sh" from="capture-pane"
```

Run alone, this capture may show only the echoed command, or an empty screen.
The next step is why.

<a id="wait-for-text-instead-of-guessing-a-delay"></a>
<a id="wait-for-output-or-completion"></a>

## 6. Capture until the line appears

The shell may not have run the command yet, so the script captures again, up to
100 times with a 50 millisecond pause. `grep -Fx` accepts only the complete
line `libtmux capture ready`, so the echoed command cannot satisfy the check,
and `-q` keeps grep quiet. On a match the script prints the screen and exits
with status 0. The captured output, not a fixed delay, decides when the program
finishes.

```sh excerpt="capture.sh" from="attempt=0" to="done"
```

## 7. Fail when the line never appears

If every attempt fails, the script reports the timeout on standard error and
exits with status 1.

```sh excerpt="capture.sh" from="Timed out" to="exit 1"
```

## 8. Clean up

`kill-server` stops the private server, and `trap cleanup EXIT` runs `cleanup`
on every exit, including the timeout in step 7. The second `trap` makes `HUP`,
`INT`, and `TERM` exit normally so cleanup still runs. If tmux cannot be
stopped, the script keeps its socket directory and prints the path, so you can
inspect or stop that server.

```sh excerpt="capture.sh" from="cleanup() {" to="trap 'exit 1'"
```

## The complete script

In the file, `cleanup` comes before the first tmux command so that it covers
every command after it. Save the script as `capture.sh`, or paste the whole
block into a POSIX shell. The parentheses run it in a subshell, so its `exit`
and traps leave your shell alone.

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

Run the saved script:

```console
$ sh capture.sh
```

The output is the captured screen, which includes the line
`libtmux capture ready`. Capture reads screen state, so it can miss output that
has scrolled away. [Capturing output](/guides/capturing-output/) covers history
and streaming; [Sending keys](/guides/sending-keys/) explains input and
completion.

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
