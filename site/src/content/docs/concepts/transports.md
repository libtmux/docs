---
supportedPorts: []
title: Control mode vs one-shot
description: Run native tmux commands once, group commands in a client, or keep a control-mode client attached.
sidebar:
  label: Control mode vs one-shot
  group: Concepts
  order: 3
tableOfContents: true
---

A `tmux` client sends commands to a server selected by its socket. A shell
invocation normally sends its commands and exits after they complete. Add
`-C` to keep an attached client that accepts commands on standard input and
reports replies and events on standard output.

| Need | Native tmux approach |
| --- | --- |
| Run a command from a shell | Start a client for that command. |
| Run several commands together | Separate tmux commands with a quoted or escaped `;`. |
| Send commands and observe events over one connection | Attach a client with `-C` and read the control protocol. |

## Group commands and open control mode

Save this complete script as `transports.sh`. It requires tmux 3.3a or newer
and a POSIX shell. It creates a private server with a command group, sends
commands through a control client, and cleans up the server.

```sh title="transports.sh"
#!/bin/sh
set -eu
directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-transports.XXXXXX")
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

windows=$(tmux -S "$socket" -f /dev/null \
    new-session -d -s work -n main 'cat' \; \
    new-window -d -t '=work:' -n logs 'cat' \; \
    list-windows -t '=work' -F '#{window_name}')
[ "$windows" = "$(printf 'main\nlogs')" ]
printf 'batch created two windows\n'

tmux -S "$socket" -C attach-session -t '=work' \
    > "$directory/control.log" <<'COMMANDS'
display-message -p 'control command ready'
list-clients -F '#{client_control_mode}'
detach-client
COMMANDS
grep -Fx 'control command ready' "$directory/control.log" > /dev/null
grep -Fx '1' "$directory/control.log" > /dev/null
printf 'control command completed\n'

tmux -S "$socket" has-session -t '=work'
printf 'session remains after control client detaches\n'
```

Run the saved script:

```console
$ sh transports.sh
```

The output is `batch created two windows`, `control command completed`, and
`session remains after control client detaches` on separate lines.

## One invocation with several commands

The escaped `\;` reaches tmux as a command separator. An unquoted shell `;`
would instead end the shell command. tmux runs the grouped commands in order
on its command queue. A failure can stop later commands in the group; earlier
mutations remain applied. The group does not roll back changes.

Creating a session with [`new-session`](/tmux/latest/manual/new-session/)
starts the server if necessary. Ending the client process leaves the server
and pane processes running. A later client can query them with
[`list-windows`](/tmux/latest/manual/list-windows/) or attach interactively.
The [command syntax](/tmux/latest/manual/full/#COMMANDS) describes separators,
quoting, command queues, and parsing.

## Read the control protocol

[`attach-session`](/tmux/latest/manual/attach-session/) with the global `-C`
flag opens a control client. Each line on its standard input is a tmux
command. Replies are enclosed by `%begin` and `%end`, or by `%begin` and
`%error` when a command fails. Asynchronous notifications can arrive between
replies; they begin with `%` and include events such as `%window-add` and
`%output`.

The script sends a fixed sequence and checks two response lines after the
client exits. A long-running controller must parse response boundaries,
command numbers, escaping, and notifications from the
[control-mode protocol](/tmux/latest/manual/full/#CONTROL_MODE). Reading one
line for each command does not identify a complete reply.

[`display-message -p`](/tmux/latest/manual/display-message/) prints its
result. [`detach-client`](/tmux/latest/manual/detach-client/) closes the
attached control client after the preceding commands complete.

## Account for the attached client

A control connection is a real tmux client. It appears in
[`list-clients`](/tmux/latest/manual/list-clients/), increments
`session_attached`, and affects hooks and options that depend on attachment.
The `client_control_mode` format distinguishes it from an interactive client.
Detaching it leaves the session running under the default configuration;
`destroy-unattached` can change that behavior.

Sending input with [`send-keys`](/tmux/latest/manual/send-keys/) reports that
tmux handled the keys. It does not prove that the pane's program finished
processing them. Use [completion signals](/topics/waiting-and-retry/) when a
later step needs a completed result.

The pinned
[tmux manual](https://github.com/tmux/tmux/blob/e476c1230b958df0cb12977517d24b3dc931375b/tmux.1)
documents command queues and control mode.
