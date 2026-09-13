---
title: "tmuxp load"
description: "Load a workspace file, saved workspace name, or project directory. Multiple inputs build in order; without `-d`, the final session is attached or selected through the current-client flow."
port: cxx
product: workspace
sidebar:
  label: "tmuxp load"
  group: "CLI reference"
  order: 10
tableOfContents: true
---

**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.

The local C++ `tmux-workspace load` supports foreground attachment, detached
loading and explicit append. Native `before_script` runs direct argv before
settings and windows; all inputs are validated first. Script failure removes a
newly owned session and preserves a borrowed append session. NDJSON streams
bounded script output.

Load a workspace file, saved workspace name, or project directory. Multiple
inputs build in order; without `-d`, the final session is attached or selected
through the current-client flow.

## Native C++ loading

Human load requires a foreground controlling terminal before mutation. Outside
tmux it attaches to the final input's session, including a reused session.
Inside tmux it switches the unique terminal client viewing the invoking pane;
zero or multiple matching clients require `-d`. Machine load requires `-d` or
`--append`; `-d` takes precedence when both are supplied.

The CLI cannot identify independent `active-pane` focus. If a terminal client
uses it on the invoking physical window, including a linked window, use `-d`
or `--append`. Clients on other physical windows do not block switching. The
check repeats before handoff; enabling the flag during a script preserves
loaded changes and prevents switching.

Load publishes and flushes both streams before handing over the terminal.
Handoff failure preserves loaded changes and reports the completed summary
when possible. The client is checked again before switching; tmux's subsequent
name-targeted operation still has a race. If all three standard streams are
redirected, use `-d`: attachment needs a stream identifying the concrete
controlling tty. See [output](../../reference/output/#native-c-load-output)
for publication failures. `--log-file PATH` appends JSON diagnostics; see
[native logging](../../reference/output/#native-c-logging) for levels and file
failure behavior.

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
distinguishes current Python flags from native all-command JSON and NDJSON.

[Parser and implementation source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/load.py).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
