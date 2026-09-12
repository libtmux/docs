---
title: "tmuxp compatibility and port status"
description: "Current local CLI capabilities, remaining gaps, and the historical builder audit."
port: cxx
product: workspace
sidebar:
  label: "tmuxp compatibility and port status"
  group: "Reference"
  order: 30
tableOfContents: true
---

**Local implementation, unpublished.** The C++ `tmux-workspace` CLI
is available in the `workspace-cli` source worktree. Its command and
configuration coverage remains partial. See [installation](../../guides/installation/)
for local setup; installing a published library does not establish availability
of this CLI.

Compatibility targets useful tmuxp 1.74.0 commands and workspace workflows, with
native validation, execution and output conventions. Matching command names does
not promise identical runtime behavior or Python semantics.

## This port

The optional application provides native `ls`, `search`, `edit`, `convert`,
`import teamocil`, `import tmuxinator`, `debug-info`, `load` and `freeze`. Its parser also contains unfinished process commands;
`shell` is not an implemented service.

Loading starts tmux when needed, creates sessions or reuses exact names. It
retains created object identities and supports command settings, directories,
environment, shells, layouts, indexes and focus. A session-name override applies
to the final input. Failed builds remove their own session and preserve earlier
successful inputs. Cold startup verifies the daemon and bootstrap session;
uncertain identity is reported as possibly retained state. Append authenticates
the inherited daemon and current pane, preserves existing windows and reports
new windows/settings retained after failure.

Ordinary human load requires a foreground controlling terminal before mutation.
Outside tmux it attaches; inside tmux it switches the unique non-control client
viewing the invoking pane. Zero or multiple matching clients are refused with
`-d` guidance. The final input selects the destination, including a reused
session. Machine load requires `-d` or `--append`.

Independent `active-pane` focus on the invoking physical window requires `-d`
or `--append`, including linked windows. This check runs before loading and
handoff; clients on other physical windows do not block switching.

Load flushes both output streams before handoff and retains loaded changes on
handoff failure. It rechecks the selected client's identity before switching;
tmux's name-targeted switch still leaves a race after that check. Attachment
needs a standard stream identifying the concrete controlling tty. With all
three standard streams redirected, use `-d`. See [load](../../cli/load/#native-c-loading).

`before_script` invokes quoted argv directly, after session creation or append
selection and before workspace settings and windows. Reusing a session skips
the script. All inputs' script arguments, directories and environment names
are validated before creation. The working directory is the configured session
directory, or the invoking directory when omitted.

Script stdin is closed. Each output stream retains up to 1 MiB; NDJSON also
emits script-output records while the child runs. Script failure or an output
limit removes only a newly owned session. Append preserves its borrowed session
and reports partial effects. Interruption joins the child group, and remaining
group processes are terminated when the script exits. No fixed script deadline
is imposed.

Conversion preserves extension fields. Imports translate names, directories,
panes, pre-commands and layouts. Capture records current commands, directories,
window names, indexes, focus and layouts; it omits environment and options and
warns about unrecoverable original arguments, history and scripts. Search uses
native C++ ECMAScript regular expressions.

Layout syntax is checked across all inputs before scripts or session creation.
Named-layout availability follows the running daemon's version, or the selected
client when starting a new server. Custom layout checks validate syntax and pane
capacity; tmux owns geometry and pruning to the requested pane count.

Every command accepts `--json` and `--ndjson`; NDJSON takes precedence. Load
flushes events and a terminal result. Diagnostics use stderr and control bytes
remain escaped in machine strings. Explicit saves publish an owned temporary
file and require `--force` for replacement. `load -2` selects 256-color mode;
`-8` fails before document lookup or tmux access.

`load --log-file PATH` appends JSON diagnostics. `--log-level` defaults to
`warning`; `info` includes load lifecycle records and `debug` adds script-output
chunks. Required errors and machine results remain visible at every level.
Invalid file destinations fail before mutation; later file errors preserve
command status, cleanup and handoff. See [logging](../output/#native-c-logging).

The editor receives parsed argv directly, using `VISUAL`, then `EDITOR`, then
`vi`. It can take the controlling terminal while machine stdout stays separate.
Without a terminal, output is bounded; exceeding the limit terminates the owned
child group. SIGINT/SIGTERM cancel captured children and their pipe-owning
descendants. Suspend/resume and non-Linux behavior need further validation.

The local source reference is apps/workspace/README.md. Use the native
executable's `--help` for the options implemented in that checkout.

### Remaining gaps

- Python shell/plugin/custom-builder services are unavailable.
- Windows created by arbitrary scripts are outside the builder's retained-window
  records, including when a borrowed append session survives script failure.
- Progress and shell completion remain unfinished. Their appearance
  in help or command metadata does not establish executable behavior.
- Additional importer fields, full configuration/capture coverage and
  supported-platform packaging remain open. Append's first explicit window
  index must name a free slot in the existing session.

## Historical builder audit

Audit date: 2026-09-09. [Native source snapshot](https://github.com/libtmux/libtmux-cxx/tree/c7f1146d2ebd7a8323d9f9814517dc3cdf86b4ee).
The following results describe that original library revision, before the local
CLI implementation. They are historical evidence, not its current capability
list or a support guarantee for a published artifact.

The library parsed 21 upstream YAML examples in the original audit. Live probes
found gaps in index assignment and command routing, first-pane environment,
split shell inheritance and `options_after` timing. The source snapshot had no
native CLI.

At that baseline, the workspace consumer was a source-tree library target. Its
YAML parser rejected fields outside its supported subset, and builder failures
could leave earlier tmux changes in place. These historical library results do
not describe the current CLI's owned-session cleanup and append reporting.

Read the port's [builder topics](../../internals/topics/) and
[API](../../internals/api/) for its library interface. Use the language switcher
to compare the same topic across ports; each port has its own coverage limits.

## Shared gaps

Parser acceptance does not prove execution support. Native regex engines and
Python plugin runtimes have different contracts; identical flags alone do not
establish compatibility. See [shell](../../cli/shell/),
[search](../../cli/search/) and [hooks](../../configuration/hooks/), and apply
this port's current limitations above when reading those reference pages.

## Optional format separator

Python libtmux exposes `LIBTMUX_TMUX_FORMAT_SEPARATOR` in its format collector.
This native CLI does not claim that setting as a supported codec control. Its
framing and decoding need their own compatible seam and collision, empty value,
Unicode and line-break checks before accepting such a setting.

## Reading examples

The [gallery](../../examples/gallery/) contains the upstream fixture corpus.
Parsing a fixture and executing its applications are separate checks. Several
require external programs, remote hosts, project directories or plugin
packages. A successful YAML read does not establish those dependencies or the
complete workspace behavior.

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
