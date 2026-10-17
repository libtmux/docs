---
supportedPorts: []
title: Attach and send keys
description: Find a tmux pane, send literal text and Enter, and capture the resulting output on a private server.
sidebar:
  label: Attach and send keys
  group: Examples
  order: 2
tableOfContents: true
---

Use [`attach-session`](/tmux/latest/manual/attach-session/) to view a session
in your terminal. A shell script can find its pane, send input with
[`send-keys`](/tmux/latest/manual/send-keys/), and read the screen with
[`capture-pane`](/tmux/latest/manual/capture-pane/).

## Find a pane and send a command

Save this complete script as `send-command.sh`. It requires tmux 3.2a or newer
and a POSIX shell. It creates a private session, selects one pane by its ID,
sends a shell command, and checks its output before cleaning up the server.

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

The output is `native input ready`. The screen check matches a complete line
from `printf`, rather than the shell's echoed command. The loop makes at most
five captures and waits one second between unsuccessful attempts. `-e PS1=`
starts the shell with an empty prompt so its prompt cannot prefix that line.

## Keep literal text and keys separate

`send-keys -l` sends the characters in the supplied string literally. The
second command sends the named `Enter` key so the pane's shell executes the
text. Supplying `Enter` to `-l` would type that word. The
[sending keys guide](/guides/sending-keys/) also covers control keys and pane
input modes.

[`has-session`](/tmux/latest/manual/has-session/) with `=demo` requires an
exact session name. [`list-panes`](/tmux/latest/manual/list-panes/) prints
the matching pane IDs, and the script checks that exactly one was returned.
Those IDs belong to the selected server. Keep the same socket on every
command, including capture and cleanup.

## Wait for the result you need

`send-keys` returning does not mean the pane's program has processed the
input. This example waits for its output condition with a bounded polling
loop. When a program can signal completion, use the
[capture example](/examples/capture-pane-output/) or
[`wait-for`](/tmux/latest/manual/wait-for/) for a named signal.

Capturing the pane reads terminal state, including prompts and screen
updates. Use the [capture guide](/guides/capturing-output/) for scrollback
ranges and wrapped lines. If another client closes the pane, the next command
fails and the cleanup trap still retires the server this script owns.

The pinned
[tmux manual](https://github.com/tmux/tmux/blob/e476c1230b958df0cb12977517d24b3dc931375b/tmux.1)
documents key names, literal input, and capture behavior.
