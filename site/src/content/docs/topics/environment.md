---
supportedPorts: []
title: Environment
description: Inspect and set native tmux server and session environments, and override a new pane process.
sidebar:
  label: Environment
  group: Topics
  order: 9
tableOfContents: true
---

tmux stores a global environment and a separate environment for each session.
When it starts a pane process, it merges the global and session values; a
session value takes precedence. Changing those stores affects future pane
processes. It does not change the environment of processes already running.

## Set defaults and a one-pane override

Save this complete script as `environment.sh`. It requires tmux 3.3a or newer
and a POSIX shell. It inspects global and session values, launches new panes,
and checks the environment each process receives on a private server.

```sh title="environment.sh"
#!/bin/sh
set -eu
directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-environment.XXXXXX")
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
tmux -S "$socket" set-environment -g DEMO_VALUE global
tmux -S "$socket" set-environment -t '=work' DEMO_VALUE session
global=$(tmux -S "$socket" show-environment -g DEMO_VALUE)
session=$(tmux -S "$socket" show-environment -t '=work' DEMO_VALUE)
[ "$global" = DEMO_VALUE=global ] && [ "$session" = DEMO_VALUE=session ]
printf 'server: %s\nsession: %s\n' "$global" "$session"

tmux -S "$socket" new-window -d -t '=work:' -n inherited \
    -e "RESULT=$directory/inherited.txt" \
    'printf "%s\n" "$DEMO_VALUE" > "$RESULT"; exec cat'
tmux -S "$socket" new-window -d -t '=work:' -n overridden \
    -e DEMO_VALUE=override -e "RESULT=$directory/overridden.txt" \
    'printf "%s\n" "$DEMO_VALUE" > "$RESULT"; exec cat'
ready=no
for attempt in 1 2 3 4 5; do
    if [ -f "$directory/inherited.txt" ] && \
        [ -f "$directory/overridden.txt" ] && \
        grep -Fx session "$directory/inherited.txt" > /dev/null && \
        grep -Fx override "$directory/overridden.txt" > /dev/null; then
        ready=yes
        break
    fi
    if [ "$attempt" -lt 5 ]; then
        sleep 1
    fi
done
[ "$ready" = yes ]
printf 'new pane: session\none-pane override: override\n'
```

Run the saved script:

```console
$ sh environment.sh
```

The output is `server: DEMO_VALUE=global`, `session: DEMO_VALUE=session`,
`new pane: session`, and `one-pane override: override` on separate lines.
The bounded loop waits for the pane processes to write their result files.
The cleanup trap then stops the private server and removes those files.

## Choose the environment store

[`set-environment -g`](/tmux/latest/manual/set-environment/) changes the
global store. Without `-g`, `-t` selects a session's store.
[`show-environment`](/tmux/latest/manual/show-environment/) reads the chosen
store. Its ordinary output uses `NAME=value` rows; `-s` prints shell commands
that can set those values.

[`new-window -e`](/tmux/latest/manual/new-window/) adds or overrides a value
for that new pane's process. The script's `DEMO_VALUE=override` leaves the
session store unchanged. [`split-window`](/tmux/latest/manual/split-window/)
also supports `-e` when starting a new pane process.

## Distinguish removal from an unset marker

`set-environment -u` removes an entry from a store. `-r` marks a variable to be
removed from the environment passed to new processes; `show-environment`
prints those removed variables with a leading `-`. Use the
[environment section](/tmux/latest/manual/full/#GLOBAL_AND_SESSION_ENVIRONMENT)
for merge rules and the `update-environment` option.

`update-environment` selects variables copied from an attaching client's
environment into the session. Read the selected release's option defaults
before depending on a value surviving a later attach.

## Identify the current pane process

Inside a tmux pane, `TMUX` identifies the server connection context and
`TMUX_PANE` contains that pane's ID. Use explicit sockets and targets in
scripts that manage another server; the caller's current pane can belong to
a different one. [Socket and servers](../socket-and-servers/) explains server
selection, and [format-token fields](../format-tokens/) covers live state
read through `display-message`.

The pinned
[tmux manual](https://github.com/tmux/tmux/blob/e476c1230b958df0cb12977517d24b3dc931375b/tmux.1)
documents the commands and formats used here.
