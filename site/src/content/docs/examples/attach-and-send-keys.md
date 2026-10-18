---
supportedPorts: []
title: Attach and send keys
description: Build a script that sends a command to a tmux pane and reads the result back, one command at a time.
sidebar:
  label: Attach and send keys
  group: Examples
  order: 2
tableOfContents: true
---

A script can drive a shell it never shows. It starts a detached session, types
into the pane with `send-keys`, and reads the screen back with `capture-pane`.
The steps below add one command each. Every block is a range of lines from the
finished `send-command.sh`, so each step shows code that runs. [The complete
script](#the-complete-script) follows the last step. It needs tmux 3.2a or
newer and a POSIX shell.

## 1. Choose a private socket

A tmux server listens on a socket, and a command reaches the server whose
socket it names. Create a directory for this run and put the socket inside it,
so the script never touches the tmux server you already use.

```sh excerpt="send-command.sh" from='directory=$(mktemp' to="tmux.sock"
```

`mktemp -d` makes a directory that no other run shares. Every later command
repeats `-S "$socket"`; a command without it would reach your default server.
[Select a server](/topics/socket-and-servers/#select-a-server) covers the socket
options.

## 2. Start a detached session

`new-session -d` creates a session without attaching your terminal to it. The
first command to use a new `-S` path starts a server there, and `-f /dev/null`
keeps that server from reading your `tmux.conf`. `-s demo` names the session,
`-n main` names its window, and the final `'sh'` is the program the pane runs.

```sh excerpt="send-command.sh" from="new-session -d"
```

`-e PS1=` gives the pane an empty prompt, so a prompt cannot prefix the output
that the script waits for in step 9. The command prints nothing and returns
once the session exists; `tmux.sock` is now in the directory. To watch the pane
yourself, pass the same socket to `attach-session`. The script reads the pane
instead and never attaches.

## 3. Check the session by exact name

`has-session` exits with a non-zero status when no session matches, and
`set -e` stops the script there. A bare `-t demo` matches every session whose
name starts with `demo`. The `=` in `=demo` requires the exact name.

```sh excerpt="send-command.sh" from="has-session"
```

## 4. Find the pane by its ID

`list-panes` prints one row for each pane in a window. `-t '=demo:main'`
selects the window named `main` of the exact session. `-f '#{pane_active}'`
keeps the rows whose pane is active, and `-F '#{pane_id}'` prints each pane's
ID in place of the default description.

```sh excerpt="send-command.sh" from='panes=$(tmux' to="pane_id"
```

`panes` now holds an ID such as `%0`. Use the ID rather than the pane's index:
indexes move as panes come and go, and start at `pane-base-index`, while the
ID names the same pane until it closes. [Stable
identity](/concepts/server-session-window-pane/#stable-identity) explains why.

## 5. Require exactly one pane

The filter should leave one row. `set -- $panes` splits the value into
positional parameters, and `[ "$#" -eq 1 ]` fails the script when there are
none or several. `pane=$1` keeps the ID. IDs contain no whitespace, so the
unquoted split is safe; the `shellcheck` comment records that choice.

```sh excerpt="send-command.sh" from="# Pane IDs contain no whitespace" to='pane=$1'
```

[Require exactly one match](/guides/querying-and-filtering/#require-exactly-one-match)
covers the same check in the language libraries.

<a id="keep-literal-text-and-keys-separate"></a>

## 6. Type text without pressing keys

`send-keys -l` types its argument literally, character by character. The
target `-t "$pane"` is the ID from step 4, so the text reaches that pane
whichever window is current.

```sh excerpt="send-command.sh" from="send-keys -l"
```

The typed text waits at the prompt. The shell has not run it, because no key
has been pressed.

## 7. Press Enter

Without `-l`, `send-keys` treats an argument that names a key as that key.
Send the `Enter` key to run the typed command. Names such as `Enter`, `C-c`,
and `Up` work this way. Adding `-l` here would type the word `Enter` instead.

```sh excerpt="send-command.sh" from="Enter"
```

The shell now runs `printf` and prints `native input ready` on a new row. The
[sending keys guide](/guides/sending-keys/#literal-text-key-names-and-whether-enter-follows)
also covers control keys and pane input modes.

## 8. Read the screen

`capture-pane -p` prints the pane's visible text to standard output. Without
`-p`, tmux copies the text into a paste buffer. The script redirects the output
to `screen.txt`.

```sh excerpt="send-command.sh" from="capture-pane"
```

A capture is a snapshot of what the pane shows at that moment, including the
echoed command. [Capturing
output](/guides/capturing-output/#visible-pane-vs-scrollback) covers
scrollback ranges and wrapped lines.

<a id="wait-for-the-result-you-need"></a>

## 9. Poll until the line appears

`send-keys` returns when tmux has queued the input, not when the shell has run
it, so the first capture can come too early. The loop repeats the capture, up
to five times with a one-second pause, and stops as soon as `grep -Fx` finds
the whole line `native input ready`. A whole-line match means the echoed `printf`
command cannot satisfy the check, and the empty prompt from step 2 keeps a
prompt from prefixing the line.

```sh excerpt="send-command.sh" from="found=no" to="done"
```

When a program can announce that it has finished, wait for that signal instead
of a timer: `wait-for` blocks until another command signals a channel, and the
[capture example](/examples/capture-pane-output/) shows the polling alternative
in more detail.

## 10. Report the result

If the line never appeared, the script prints an error to standard error and
exits with status 1. Otherwise it prints the line, which is the script's output.

```sh excerpt="send-command.sh" from='"$found" != yes' to="printf 'native input ready"
```

## 11. Clean up

`kill-server` stops the private server and removes its socket. `trap cleanup 0`
runs `cleanup` whenever the script exits, whether it succeeded or failed, and
the second `trap` turns `HUP`, `INT`, and `TERM` into a normal exit so cleanup
still runs. If tmux cannot be stopped, the script keeps the directory and
prints its path, so you can stop that server yourself. If another client closes
the pane, the next command fails and the same trap retires the server.

```sh excerpt="send-command.sh" from="cleanup() {" to="trap 'exit 1'"
```

## The complete script

The steps follow the order a reader meets the commands. In the file, `cleanup`
comes first so that it covers every command after it. Save the script as
`send-command.sh`:

```sh title="send-command.sh"
#!/bin/sh
set -eu
directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-send-command.XXXXXX")
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

tmux -S "$socket" -f /dev/null new-session -d -e PS1= -s demo -n main 'sh'
tmux -S "$socket" has-session -t '=demo'
panes=$(tmux -S "$socket" list-panes -t '=demo:main' \
    -f '#{pane_active}' -F '#{pane_id}')
# Pane IDs contain no whitespace; reject zero or multiple rows.
# shellcheck disable=SC2086
set -- $panes
[ "$#" -eq 1 ]
pane=$1

tmux -S "$socket" send-keys -l -t "$pane" "printf 'native input ready\\n'"
tmux -S "$socket" send-keys -t "$pane" Enter
found=no
for attempt in 1 2 3 4 5; do
    tmux -S "$socket" capture-pane -p -t "$pane" > "$directory/screen.txt"
    if grep -Fx 'native input ready' "$directory/screen.txt" > /dev/null; then
        found=yes
        break
    fi
    if [ "$attempt" -lt 5 ]; then
        sleep 1
    fi
done
if [ "$found" != yes ]; then
    printf 'Expected pane output did not appear\n' >&2
    exit 1
fi
printf 'native input ready\n'
```

Run the saved script:

```console
$ sh send-command.sh
```

The output is `native input ready`.

The pinned
[tmux manual](https://github.com/tmux/tmux/blob/e476c1230b958df0cb12977517d24b3dc931375b/tmux.1)
documents key names, literal input, and capture behavior.
