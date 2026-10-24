---
supportedPorts: []
title: Options and hooks
description: Set native tmux options at their supported scope and run hook commands on events.
sidebar:
  label: Options and hooks
  group: Topics
  order: 6
tableOfContents: true
---

Options configure tmux behavior, and hooks run tmux commands when events
occur. Choose the scope before changing a value: a server setting, a global
session default, one session, a window default, or one window can have
different effects.

## Set options and observe an event

Save this complete script as `options.sh`. It requires tmux 3.3a or newer and
a POSIX shell. It checks a global default and local overrides, then registers
and removes a session hook on its private server.

```sh title="options.sh"
#!/bin/sh
set -eu
directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-options.XXXXXX")
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

tmux -S "$socket" -f /dev/null new-session -d -s work -n main 'cat'
tmux -S "$socket" set-option -g status off
tmux -S "$socket" set-option -t '=work:' status on
tmux -S "$socket" set-window-option -t '=work:main' automatic-rename off
global=$(tmux -S "$socket" show-options -g -v status)
session=$(tmux -S "$socket" show-options -v -t '=work:' status)
rename=$(tmux -S "$socket" show-window-options -v \
    -t '=work:main' automatic-rename)
[ "$global" = off ] && [ "$session" = on ] && [ "$rename" = off ]
printf 'global status: %s\nsession status: %s\n' "$global" "$session"
printf 'window automatic-rename: %s\n' "$rename"

tmux -S "$socket" set-hook -t '=work:' after-new-window \
    'set-option -t =work: @created yes'
tmux -S "$socket" new-window -d -t '=work:' -n hooked 'cat'
created=$(tmux -S "$socket" show-options -v -t '=work:' @created)
[ "$created" = yes ]
printf 'hook ran: %s\n' "$created"
tmux -S "$socket" set-hook -u -t '=work:' after-new-window
```

Run the saved script:

```console
$ sh options.sh
```

The output is `global status: off`, `session status: on`,
`window automatic-rename: off`, and `hook ran: yes` on separate lines.
The hook sets a user option when the new window is created; the following
read checks that result.

## Choose option scope and inheritance

[`set-option`](/tmux/latest/manual/set-option/) changes options and
[`show-options`](/tmux/latest/manual/show-options/) reads them. `-g` selects
global defaults for session options; `-t` selects a particular session.
`-s` selects server options. Window and pane options use `-w` and `-p`,
respectively, where the selected release supports that option's scope.

[`set-window-option`](/tmux/latest/manual/set-window-option/) and
[`show-window-options`](/tmux/latest/manual/show-window-options/) select
window options. A local value overrides its global default. Unsetting a
local option with `-u` restores inheritance where that option supports it;
it is different from assigning an empty value.

`show-options -v` prints the value alone. User options begin with `@` and can
store application-specific strings, such as the script's `@created` marker.
Inspect the [options reference](/tmux/latest/manual/full/#OPTIONS) for types,
valid scopes, array handling, and version-specific settings.

## Run and remove hooks

[`set-hook`](/tmux/latest/manual/set-hook/) registers tmux commands for an
event. The script uses the session's `after-new-window` hook. Hook bodies are
tmux command strings, so the shell quotes them before tmux parses them.
Use [`run-shell`](/tmux/latest/manual/run-shell/) inside a hook when its task
needs a shell command.

[`show-hooks`](/tmux/latest/manual/show-hooks/) lists installed hooks.
`set-hook -u` removes a hook at the selected scope. Hook arrays can contain
several commands; replacing an entry and appending one have different effects.
The [hooks reference](/tmux/latest/manual/full/#HOOKS) lists events and
supported scopes. An `after-` hook runs after its associated command succeeds.

Keep hooks targeted to the resources they should change. A global hook can
affect other sessions, and a hook that runs the same event-producing command
needs a design that avoids unintended repeated work.

## tmux version compatibility

The script's commands work on both documented tmux versions. Check
the event itself when choosing a hook; its availability belongs to tmux,
independently of a library's API.

| Feature | tmux 3.2a | tmux 3.7c |
|---------|-----------|-----------|
| `pane-title-changed` hook | Supported | Supported |

`pane-title-changed` runs when a pane's title changes, including a change
made with [`select-pane -T`](/tmux/latest/manual/select-pane/).
The hook was [added before tmux 3.2](https://github.com/tmux/tmux/commit/d329b035cee47d968a8c93b5cbd8fde879ce6f0d)
and is registered in both the
[3.2a source](https://github.com/tmux/tmux/blob/3b929f332aafa7f1080eacc31feb11ffbb1d1841/options-table.c#L1143)
and the
[3.7c source](https://github.com/tmux/tmux/blob/e476c1230b958df0cb12977517d24b3dc931375b/options-table.c#L1700).

The pinned
[tmux manual](https://github.com/tmux/tmux/blob/e476c1230b958df0cb12977517d24b3dc931375b/tmux.1)
documents the commands and formats used here.
