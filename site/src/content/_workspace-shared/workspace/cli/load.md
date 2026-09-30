---
description: Create or reuse a session from a workspace file, with explicit attachment and output choices.
product: workspace
sidebar:
  group: CLI reference
  label: Load a workspace
  order: 10
tableOfContents: true
title: Load a workspace
---

<!-- port:py -->
Load a workspace file, saved workspace name, or project directory. Multiple
inputs build in order; without `-d`, the final session is attached or selected
through the current-client flow.
## Loading and attachment

Create [`workspace.yaml`](../../guides/installation/#create-the-input) using the [installation
walkthrough](../../guides/installation/), then load it on that walkthrough's
dedicated socket:

```console
$ tmuxp load \
    -L workspace-guide \
    -d \
    workspace.yaml
```

`-d` avoids attachment. Inside an existing tmux client, the normal interactive
flow can switch to the new session, append windows, or stay detached. `--append`
explicitly selects the append flow and needs a current target session. An
existing session is handled through tmuxp's load policy; loading is not a
declarative reconciliation operation that removes surplus windows.

Put flags before the complete group of filenames. The reference accepts flags
before or after that group, but a flag between two filenames can cause an
argument error. `-s` overrides the final input's session name when several files
are loaded. tmuxp parses `-2` and `-8` as mutually exclusive flags,
separate from the CLI text's `--color` setting. Legacy `-8` is unsupported;
[tmux removed 88-color support](https://raw.githubusercontent.com/tmux/tmux/3.2a/CHANGES).

## Progress and script output
`--progress-format` accepts `default`, `minimal`, `"window"`, `"pane"`, `verbose`,
or a custom format. Available tokens include `{session}`, `{window}`,
`{window_index}`, `{window_total}`, `{window_progress}`,
`{window_progress_rel}`, `{windows_done}`, `{windows_remaining}`,
`{pane_index}`, `{pane_total}`, `{pane_progress}`, `{progress}`,
`{session_pane_progress}`, `{overall_percent}`, `{bar}`, `{pane_bar}`,
`{window_bar}`, and `{status_icon}`.

The output panel defaults to three lines. `--progress-lines 0` hides the panel
and sends script output to stdout; `-1` permits all available lines up to
terminal height. `--no-progress` disables animation. See [environment
settings](../../configuration/environment/) for environment bindings and
[command ordering](../../configuration/commands/) for what is executed.
## Arguments and flags

| Argument or flags | Arity / default | Choices or meaning |
| --- | --- | --- |
| `"workspace_files"` | one or more | filepath to session or filename of session in tmuxp workspace directory |
| `-L` | value; None | passthru to tmux(1) -L |
| `-S` | value; None | passthru to tmux(1) -S |
| `-f` | value; None | passthru to tmux(1) -f |
| `-s` | value; None | start new session with new session name |
| `--yes`, `-y` | flag; False | always answer yes |
| `-d` | flag; False | load the session without attaching it |
| `-a`, `--append` | flag; False | load workspace, appending windows to the current session |
| `-2` | flag; None | force tmux to assume the terminal supports 256 colours. |
| `-8` | flag; None | legacy 88-colour flag; unsupported by tmux 3.2a+ |
| `--log-file` | value; None | file to log errors/output to |
| `--progress-format` | value; None | Spinner line format: preset name (default, minimal, window, pane, verbose) or a format string with tokens {session}, {window}, {progress}, {window_progress}, {pane_progress}, etc. Env: TMUXP_PROGRESS_FORMAT |
| `--progress-lines` | value; None | Number of script-output lines shown in the spinner panel (default: 3). 0 hides the panel entirely (script output goes to stdout). -1 shows unlimited lines (capped to terminal height). Env: TMUXP_PROGRESS_LINES |
| `--no-progress` | flag; False | Disable the animated progress spinner. Env: TMUXP_PROGRESS=0 |

All commands accept `-h` / `--help`. Root options precede the command; see the
[CLI overview](../). The [output reference](../../reference/output/)
describes the formats supported by each command.
[Parser and implementation source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/load.py).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
<!-- /port -->

<!-- port:ts,rs,go,java,dotnet,cxx,swift -->
Load a saved configuration into tmux. Use `-d` for scripts so the command returns
after construction without attaching a terminal. Command delivery does not mean
the programs running in those panes have finished or become ready.

## Load without attaching

Continue the [installation walkthrough](../../guides/installation/) with its
`workspace.yaml` and private socket:

```console
$ tmux-workspace load \
    -S "$WORKSPACE_TMP/tmux.sock" \
    -f /dev/null \
    -d \
    --json \
    workspace.yaml
```

`-S` selects the socket path; `-L` selects a socket name. `-f` supplies tmux's
configuration when starting a server. Keep the same endpoint for later capture,
inspection and cleanup. Pass `-s another-name` to override the final input's
session name.

## Existing sessions and append

A session with the requested name is reused. Loading is not a reconciliation
operation that removes extra windows. Inspect a failed result before retrying:
earlier inputs and changes to a borrowed session can remain.

Inside tmux, `--append` adds windows to the invoking pane's session. It needs
valid `TMUX` and `TMUX_PANE` values for the selected daemon. Use `-d` when loading
onto a different server. Multiple inputs are processed in their supplied order.

## Attachment and output

Human loading can attach a terminal or switch a tmux client. For automation,
choose `-d` or an authenticated append explicitly; machine output does not
answer interactive questions. `--yes` accepts supported confirmations.

`--json` returns a result; `--ndjson` emits records as work proceeds. Read
[output](../../reference/output/) and [errors](../../reference/exit-codes/)
before consuming those records. `--no-progress` disables the terminal display;
it does not disable errors. `-2` requests 256-color handling from tmux.

Use [configuration](../../configuration/) for fields and
[hooks](../../configuration/hooks/) for bootstrap scripts and extensions.

<!-- port:ts -->
[CLI source](https://github.com/libtmux/libtmux-ts/blob/f36d692552bb9a373b45338bb5fece854e57cc3d/packages/workspace-cli/README.md).
<!-- /port -->
<!-- port:rs -->
[CLI source](https://github.com/libtmux/libtmux-rs/blob/e9be0b6f6d22cd2eb79b0ec08964f82e717e5fe4/crates/tmux-workspace/docs/cli.md).
<!-- /port -->
<!-- port:go -->
[CLI source](https://github.com/libtmux/libtmux-go/blob/bb06e26e116e941813ca40bf45e7e3a47d38f52a/workspace/CLI.md).
<!-- /port -->
<!-- port:java -->
[CLI source](https://github.com/libtmux/libtmux-java/blob/3e5b20d22af3890ae5f7f52842e4b05d170a983f/libtmux-workspace-cli/README.md).
<!-- /port -->
<!-- port:dotnet -->
[CLI source](https://github.com/libtmux/libtmux-dotnet/blob/f77fe776ba67a04abb20ddbbc26cf4a000d63b74/src/LibTmux.Workspace.Cli/README.md).
<!-- /port -->
<!-- port:cxx -->
[CLI source](https://github.com/libtmux/libtmux-cxx/blob/9c8c6a264114277df84c9f6819855093adae5c6e/apps/workspace/README.md).
<!-- /port -->
<!-- port:swift -->
[CLI source](https://github.com/libtmux/libtmux-swift/blob/53c67947879f4976ddf2c43f3c8df7c7671c5b19/Sources/TmuxWorkspaceCLI/README.md).
<!-- /port -->
<!-- /port -->
