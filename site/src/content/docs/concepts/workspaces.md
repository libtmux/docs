---
supportedPorts: []
title: Workspaces
description: Build a native tmux workspace with session, window, pane, and layout commands.
sidebar:
  label: Workspaces
  group: Concepts
  order: 5
tableOfContents: true
---

A workspace is an arrangement of tmux windows and panes for a task. Native
tmux builds that arrangement with commands such as
[`new-session`](/tmux/latest/manual/new-session/),
[`new-window`](/tmux/latest/manual/new-window/), and
[`split-window`](/tmux/latest/manual/split-window/). The layout and the
processes running inside its panes are separate: rearranging panes keeps their
programs running.

## Build a pane layout

Save this complete script as `layout.sh`. It requires tmux 3.3a or newer and
a POSIX shell. It creates a three-pane editor window and a one-pane logs
window on a private server, then stops that server on exit.

```sh title="layout.sh"
#!/bin/sh
set -eu
directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-layout.XXXXXX")
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

main=$(tmux -S "$socket" -f /dev/null new-session -d -P \
    -F '#{pane_id}' -s dev -n editor -x 100 -y 30 'cat')
right=$(tmux -S "$socket" split-window -h -d -P \
    -l '30%' -F '#{pane_id}' -t "$main" 'cat')
tmux -S "$socket" split-window -v -d -l '50%' -t "$right" 'cat'
tmux -S "$socket" select-layout -t "$main" main-vertical > /dev/null
tmux -S "$socket" select-pane -t "$main"

editor=$(tmux -S "$socket" display-message -p -t "$main" \
    '#{session_name}:#{window_name}:#{window_panes}')
[ "$editor" = dev:editor:3 ]
printf '%s\n' "$editor"
active=$(tmux -S "$socket" display-message -p -t "$main" '#{pane_active}')
[ "$active" = 1 ]
printf 'main pane selected\n'

tmux -S "$socket" new-window -d -t '=dev:' -n logs 'cat'
logs=$(tmux -S "$socket" list-windows -t '=dev' \
    -f '#{==:#{window_name},logs}' -F '#{window_panes}')
[ "$logs" = 1 ]
printf 'dev:logs:%s\n' "$logs"
```

Run the saved script:

```console
$ sh layout.sh
```

The output is `dev:editor:3`, `main pane selected`, and `dev:logs:1` on
separate lines. `cat` keeps every pane alive without requiring project files
or a development toolchain.

## Choose split direction and size

`split-window -h` places the new pane to the right; `-v` places it below.
The default is a vertical split. Add `-b` to create the new pane to the left
or above instead. With `-l`, a number selects columns for a horizontal split
or lines for a vertical split. A value ending in `%` uses a percentage of the
available space.

The script records pane IDs from `-P -F '#{pane_id}'`. Passing those IDs to
later commands keeps the splits tied to the intended pane. `-d` keeps the new
pane or window from becoming active. Use
[`select-pane`](/tmux/latest/manual/select-pane/) and
[`select-window`](/tmux/latest/manual/select-window/) when you want to change
focus explicitly.

## Apply a layout

[`select-layout`](/tmux/latest/manual/select-layout/) rearranges existing
panes. Presets include `even-horizontal`, `even-vertical`, `main-horizontal`,
`main-vertical`, and `tiled`. The script applies `main-vertical` after its
splits, so that preset determines the final geometry rather than the earlier
split percentages.

Set an initial detached size with `new-session -x` and `-y` when your script
needs room for several panes. Attached client sizes and the `window-size`
option can change the window size later. A split can fail if the target pane
has too little space; keep that command's error visible.

## Store the commands in a file

[`source-file`](/tmux/latest/manual/source-file/) reads tmux commands from a
file on the selected server. The [workspace file example](/examples/workspace-from-file/)
shows a complete command file and its shell launcher. Commands run in order;
an error can leave earlier changes applied. Loading a file again can also fail
when its session name already exists.

tmux command files use tmux syntax. Applications that load YAML or JSON add
their own configuration formats and lifecycle rules. Use the native command
file when tmux commands already express the layout you need.

## Clean up what the script owns

[`kill-pane`](/tmux/latest/manual/kill-pane/),
[`kill-window`](/tmux/latest/manual/kill-window/), and
[`kill-session`](/tmux/latest/manual/kill-session/) remove those objects and
their pane processes. [`kill-server`](/tmux/latest/manual/kill-server/) stops
every session on the selected server. The example can use it because the
private socket belongs only to that script.

For cleanup inside a shared server, retain the IDs of the objects you created
and remove those objects. A linked window can belong to several sessions;
[the object hierarchy](../server-session-window-pane/) explains that ownership
boundary. The [isolated test guide](/guides/testing-with-libtmux/) shows cleanup
that preserves command failures.

The pinned
[tmux manual](https://github.com/tmux/tmux/blob/e476c1230b958df0cb12977517d24b3dc931375b/tmux.1)
documents the split, sizing, and layout commands.
