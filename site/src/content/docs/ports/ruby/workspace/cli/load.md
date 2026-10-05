---
title: load
description: Create a Ruby workspace on an explicitly selected existing tmux server.
port: ruby
product: workspace
sidebar:
  group: CLI reference
  label: load
  order: 3
tableOfContents: true
---

`load` applies a creation plan to an existing server selected by `--socket`.
It creates a new session and leaves it detached by default. It does not
reconcile, replace, or delete a preexisting workspace.

## Create a workspace

Install tmux and the workspace gem using the [installation instructions](../../../),
then save the [complete example configuration](../../examples/) as
`workspace.yaml`. Run these commands in the same POSIX shell.

Create a temporary directory for this example's private socket:

```console
$ WORKSPACE_TMP=$(mktemp -d)
```

Start a private server with a keepalive session and no user configuration:

```console
$ tmux \
    -S "$WORKSPACE_TMP/tmux.sock" \
    -f /dev/null \
    new-session -d -s manual-keepalive
```

Load the workspace on that socket:

```console
$ libtmux-workspace load \
    --socket "$WORKSPACE_TMP/tmux.sock" \
    --json \
    workspace.yaml
```

The result records completed steps, effects, and created references. Inspect
the example's `work` session:

```console
$ tmux \
    -S "$WORKSPACE_TMP/tmux.sock" \
    list-windows -t work
```

This lists the `editor` window. When finished, stop only the private server:

```console
$ tmux -S "$WORKSPACE_TMP/tmux.sock" kill-server
```

Remove the private socket and temporary directory after stopping the server:

```console
$ rm -rf "$WORKSPACE_TMP"
```

## Options

| Option | Behavior |
| --- | --- |
| `--socket PATH` | Required path to an existing server's socket. Relative paths resolve from the current directory. |
| `--timeout SECONDS` | Finite positive deadline for each apply or switch operation; defaults to `5`. It is not a deadline for the whole workspace. |
| `--compensate` | Attempt guarded cleanup of positively identified created resources after application failure. It cannot undo shell effects. |
| `--attach` | Attach this CLI's terminal after loading. Requires `/dev/tty` and a valid `TERM`. |
| `--switch CLIENT` | Switch the explicitly named current client to the created session after loading. There is no fallback client selection. |

`--attach` and `--switch` are mutually exclusive. `--live` belongs to `plan`
and is invalid for `load`. The [common options](../#input-and-common-options)
cover JSON output, file discovery, and explicit environment expansion.

## Results and failures

Success means that the creation operations completed and configured shell
commands were dispatched. It does not mean those programs finished or became
ready. Inspect their output or use an application-specific readiness signal.

A failed operation can leave completed steps in place. The result retains
created references and effects for inspection; do not retry blindly. The
default preserves partial state. `--compensate` attempts cleanup only when
ownership can be established.

If post-load attachment or switching fails, the created session and its ledger
remain available and the command returns status `3`. Read the [exit statuses](../#output-and-exit-statuses)
when using JSON output in a script.

[CLI parser and implementation](https://github.com/libtmux/libtmux-ruby/blob/9b1545562a112353c2c893a1d3e8c0d9b4b51f8d/gems/libtmux-workspace/lib/libtmux/workspace/cli.rb).
