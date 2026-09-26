---
description: Load a workspace file, saved workspace name, or project directory. Multiple inputs build in order; without `-d`, the final session is attached or selected through the current-client flow.
product: workspace
sidebar:
  group: CLI reference
  label: tmuxp load
  order: 10
tableOfContents: true
title: tmuxp load
---

<!-- port:py -->This page documents the available Python tmuxp reference. Proposed native
extensions are labeled separately.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.
<!-- /port --><!-- port:cxx,swift -->
<!-- /port --><!-- port:cxx -->The local C++ `tmux-workspace load` supports foreground attachment, detached
loading and explicit append. Native `before_script` runs direct argv before
settings and windows; all inputs are validated first. Script failure removes a
newly owned session and preserves a borrowed append session. NDJSON streams
bounded script output.
<!-- /port --><!-- port:swift -->The local Swift `tmux-workspace load` attaches from a foreground terminal and
offers switch, detached, append or cancel choices inside tmux. `-y` skips the
mode prompt but refuses an ambiguous client selection. Redirected and machine
calls require `-d` or `--append`. Inputs are validated before prompting, and
detaching or interrupting the client preserves the loaded workspaces.

Clients using independent `active-pane` focus on the invoking pane's physical
window prevent native switching. The `n` (detached) and `a` (append) choices
remain available; such clients on other windows do not block switching. If the
selected client gains `active-pane` before handoff, switching fails and the
loaded workspace is preserved.
<!-- /port -->
Load a workspace file, saved workspace name, or project directory. Multiple
inputs build in order; without `-d`, the final session is attached or selected
through the current-client flow.
<!-- port:rs,go,dotnet,cxx -->
<!-- /port --><!-- port:rs -->The local Rust `tmux-workspace load --append` validates the inherited daemon
before Python lookup and retains the borrowed session across inputs. It rejects
missing or replaced targets. Native `-8` and `--88-colors` requests fail before
reading workspace files; use `-2` for 256 colors. See
[local coverage](../../reference/compatibility/) for the remaining gaps.
<!-- /port --><!-- port:dotnet -->The native .NET CLI's `--append` authenticates the inherited daemon and retains
one session across all inputs. It uses the current pane's session as resolved
by tmux; moving the pane later does not change that destination. Later commands
reject a replacement daemon, including global options after a startup script.
Append with Python plugins or custom builders fails before building any input
or starting Python. Use `-d` to load those extensions into a separate session.
<!-- /port --><!-- port:cxx -->## Native C++ loading
<!-- /port --><!-- port:rs,dotnet,cxx -->
<!-- /port --><!-- port:rs -->See [native Rust load reporting](../../reference/output/#native-rust-load-reporting)
for retained effects and child exit status when result output fails.
<!-- /port --><!-- port:cxx -->Human load requires a foreground controlling terminal before mutation. Outside
tmux it attaches to the final input's session, including a reused session.
Inside tmux it switches the unique terminal client viewing the invoking pane;
zero or multiple matching clients require `-d`. Machine load requires `-d` or
`--append`; `-d` takes precedence when both are supplied.
<!-- /port --><!-- port:rs,cxx -->
<!-- /port --><!-- port:rs -->Native load can append [filtered JSON logs](../../reference/output/#native-rust-logging)
with `--log-file`; `--log-level` selects optional records.
<!-- /port --><!-- port:go -->The local Go CLI's `load --append` authenticates the inherited server and
retains one destination session for all inputs. Moving the invoking pane during
a script does not change that destination. Python extension append uses the
same retained target and rejects documents with a `before_script` key. See
[compatibility status](../../reference/compatibility/) for the execution limits.
<!-- /port --><!-- port:dotnet -->Native load creates panes in configuration order, including windows with
three or more panes. `pane-base-index` changes the first index, and explicit
focus selects the configured pane without reordering it. See
[pane configuration](../../configuration/panes/).
<!-- /port --><!-- port:cxx -->The CLI cannot identify independent `active-pane` focus. If a terminal client
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
<!-- /port -->
## Loading and attachment

Create [`workspace.yaml`](../../guides/installation/#create-the-input) using the [installation
walkthrough](../../guides/installation/), then load it on that walkthrough's
dedicated socket:

```console
$ tmuxp load \
<!-- port:py -->    -L workspace-guide \
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->    -S "$WORKSPACE_TMP/tmux.sock" \
<!-- /port -->    -d \
<!-- port:py -->    workspace.yaml
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->    "$WORKSPACE_TMP/workspace.yaml"
<!-- /port -->```

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

<!-- port:go -->The native Go CLI supports `--log-level` and structured `--log-file` output
on Unix. It checks the log destination before Python or tmux starts. A later
logging failure preserves the workspace outcome; `script-output` records use
`debug`. See the [logging contract](../../reference/output/#native-go-logging).
<!-- /port --><!-- port:dotnet -->The native .NET command rejects `-8` and `--88-colors` before reading workspace
files or running tmux or Python. On Linux x64, `load --log-file PATH` appends
structured logs. Select `--log-level info` for lifecycle records or `debug` to
include script output. The [output reference](../../reference/output/)
describes destination validation and failure handling.

## Native .NET attachment

Human load requires a foreground controlling terminal on Linux x64 for
attachment. Inside tmux, choose `y` to switch a client, `n` to load detached,
or `a` to append. `-y` refuses an ambiguous client choice. A client using
independent `active-pane` focus on the invoking window prevents handoff;
detached and append modes remain available.

The CLI authenticates the invoking pane and daemon before building, flushes
output, and checks the selected client again before handoff. Late failures
print recorded load results on stderr. SIGINT and SIGTERM report cancellation;
a completed load can remain present after interruption during attachment.
A client name can still be reused after the final client observation.

Attached Python extension handoff remains unavailable. Use `-d` or choose `n`
to run those extensions detached. See the
[native handoff source](https://github.com/libtmux/libtmux-dotnet/blob/4ac82a5b82fd8cf68d31c70a2a3eb43c587cd7c0/src/LibTmux.Workspace.Cli/LoadHandoff.cs).
<!-- /port --><!-- port:go,dotnet -->
<!-- /port -->## Progress and script output
<!-- port:dotnet -->
Native .NET load implements the presets and named tokens below on a stderr
terminal with verified geometry on Linux x64. Templates treat bare names as
tokens and `{{`/`}}` as literal braces; unknown fields, conversions and format
specifiers remain literal. Explicit format and line-count flags override their
environment defaults. Disabled drawing does not validate unused progress
environment values.
<!-- /port -->
`--progress-format` accepts `default`, `minimal`, `"window"`, `"pane"`, `verbose`,
or a custom format. Available tokens include `{session}`, `{window}`,
`{window_index}`, `{window_total}`, `{window_progress}`,
`{window_progress_rel}`, `{windows_done}`, `{windows_remaining}`,
`{pane_index}`, `{pane_total}`, `{pane_progress}`, `{progress}`,
`{session_pane_progress}`, `{overall_percent}`, `{bar}`, `{pane_bar}`,
`{window_bar}`, and `{status_icon}`.

<!-- port:py,ts,rs,go,java,cxx -->The output panel defaults to three lines. `--progress-lines 0` hides the panel
<!-- /port --><!-- port:dotnet -->The tmuxp output panel defaults to three lines. `--progress-lines 0` hides the panel
<!-- /port --><!-- port:py,ts,rs,go,java,dotnet,cxx -->and sends script output to stdout; `-1` permits all available lines up to
<!-- /port --><!-- port:swift -->The Python reference panel defaults to three lines. `--progress-lines 0` hides
the panel and sends script output to stdout; `-1` permits all available lines up to
<!-- /port -->terminal height. `--no-progress` disables animation. See [environment
settings](../../configuration/environment/) for environment bindings and
[command ordering](../../configuration/commands/) for what is executed.
<!-- port:py,ts,rs,dotnet,swift -->
<!-- /port --><!-- port:ts -->The local TypeScript CLI uses an optional Python bridge for explicit plugins or
custom builders. Extension progress shows the workspace label and script output
without native pane counters. See [hooks and builders](../../configuration/hooks/)
for runtime requirements and append restrictions, and [output](../../reference/output/)
for observed effects.
<!-- /port --><!-- port:dotnet -->The native panel also defaults to three lines, but `--progress-lines 0`
preserves each decoded script stream's original destination. Native pane
counters advance after command delivery and configured delays; they do not
measure shell command completion. Python extensions show a generic activity
label. `--no-progress`, `TMUXP_PROGRESS=0`, `TERM=dumb`, machine output and
redirected stderr disable drawing. `NO_COLOR` removes styling while keeping
updates. On resize, drawing stops, the old frame remains and raw output resumes.
<!-- /port --><!-- port:swift -->Native Swift also defaults to three panel lines. Hiding its panel preserves
each bootstrap stream's original destination. The panel updates while the
script runs, retains at most 65,536 UTF-8 bytes and uses the initial terminal
size without tracking resize events. JSON and NDJSON disable the panel and send
live bootstrap chunks as structured stderr warnings. Cancellation clears the
panel and attempts bounded final output; see the
[child output contract](../../reference/output/#native-swift-child-output).
<!-- /port --><!-- port:ts,go,java,dotnet,cxx,swift -->
<!-- /port -->## Arguments and flags

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
<!-- port:py -->distinguishes current Python flags from proposed all-command JSON and NDJSON.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->distinguishes current Python flags from native all-command JSON and NDJSON.
<!-- /port -->
[Parser and implementation source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/load.py).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
