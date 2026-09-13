---
title: "JSON, NDJSON, and semantic color"
description: "Python output and the native CLI stream and color contract."
port: dotnet
product: workspace
sidebar:
  label: "JSON, NDJSON, and semantic color"
  group: "Reference"
  order: 29
tableOfContents: true
---

**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../compatibility/) describes this port's implemented coverage.

**Native CLI development contract.** The local `workspace-cli` worktrees provide JSON and NDJSON output. The schema below is the shared target; implemented command coverage remains port-specific. Python tmuxp provides JSON and NDJSON on `ls` and `search`, and JSON on `debug-info`.

## Format selection

The shared contract accepts `--json` and `--ndjson` before or after every leaf command.
NDJSON wins when both are present. A saved workspace's encoding is separate:
`freeze -f yaml` describes the file, while `--json` describes the CLI result
stream. Machine output has no ANSI styling, prompts, spinner frames, or raw
child output.

The native .NET CLI disables machine styling and progress, but .NET Console
initialization can still emit keypad controls when stdout is a terminal. Use
redirected stdout for machine consumption. Console writes do not provide a
hard cancellation deadline.

For native .NET commands, `--log-level debug|info|warning|error|critical`
filters optional warnings and file records; the default is `warning`. It does
not suppress command errors or JSON/NDJSON result events.

On Linux x64, native `load --log-file PATH` appends UTF-8 JSON lines without
terminal colors. Select `info` for lifecycle records or `debug` to include
script output. Relative paths use the invocation directory. New files allow
only owner read/write; existing content and permissions are preserved.
Directories, pipes, devices and symbolic links are rejected before tmux or
Python runs. Other platforms reject `--log-file`.

Failure to open the log prevents execution. A later write or close failure
disables logging and reports at most one secondary warning; the workspace
result, original error or cancellation is preserved. Python delegation leaves
the file under native ownership, but still delegates the whole load and lacks
native per-input accounting.

## Machine output

The document-to-stdout behaviors below are new machine-mode extensions. In the
pinned reference, freeze always saves a file and quiet only suppresses status
text. Separate the workspace file's encoding from the CLI stream's encoding.
`freeze -f json` selects the document format. `--json` selects structured CLI
output. Never append a status line to raw YAML or JSON document output.

| Command | JSON stdout | NDJSON stdout |
| --- | --- | --- |
| `ls` | Object containing `workspaces` and `global_workspace_dirs`, retaining tmuxp's existing record fields. Empty discovery yields the same object with an empty array. | One workspace record per line, matching tmuxp. Empty discovery emits zero records. Directory diagnostics stay on stderr. |
| `search` | Array of result records with `"name"`, `"path"`, `"session_name"`, `"source"`, `matched_fields`, `"matches"`. Empty results yield `[]`. | One result record per line. Empty results emit zero records. |
| `debug-info` | One diagnostics object. Retain home masking for named path fields, define redaction for raw tmux values, and add port/runtime details under named fields. | One compact diagnostics object plus newline. |
| `tmuxp load` | Versioned operation summary: command, status, results, errors and completed/failed stages. | Ordered operation events followed by exactly one terminal result. |
| `tmuxp freeze` | The workspace document as a JSON object when writing stdout; if saving to a file, a versioned save result containing destination, format and recoverability warnings. | One versioned capture/save result per line, with a `"workspace"` object when returning the document. |
| `convert` and importer leaves | The converted document as JSON when writing stdout; a versioned save result when an explicit destination is supplied. | One versioned conversion/save result with a nested document when returning it. |
| `edit` | One versioned result after the editor exits, including selected file and child status. | One terminal edit result; interactive editor display uses the terminal rather than machine stdout. |
| `"shell"` | For `-c`, one result containing captured Python stdout/stderr and child status. Interactive REPL requires a separate terminal; otherwise reject before execution. | For `-c`, stream captured Python output events and one terminal result. Interactive behavior has the same terminal requirement. |

Keep the established read-command JSON shapes rather than forcing a new
universal envelope around existing pipelines. New operation envelopes use
integer `schema_version: 1`. Search's empty array is a deliberate correction to
tmuxp 1.74.0's empty byte stream. No-pattern machine search must return usage
status 2, empty stdout and a structured stderr diagnostic. Explicit `--help`
remains a documented human-help request. Invalid patterns must return usage
status 2 and a diagnostic; tmuxp's current JSON search can silently return no
output for an invalid regex.

A new load summary has `schema_version`, `"command"`, `"status"` (`ok`, `partial` or
`"error"`), `results` and `errors`. Each result identifies its workspace input and
created/reused session; IDs are strings because tmux uses prefixes such as `$`,
`@` and `%`. Errors include a stable `code`, a readable `message`, the input
index and any completed/failed stage. Do not serialize native exception objects,
language-specific field capitalization or unserializable handles.

NDJSON operation events have `schema_version`, `"command"`, `event`, a
monotonically increasing `"sequence"`, and event-specific data. The initial
vocabulary is `started`, `workspace-started`, `session-created`,
`window-created`, `pane-created`, `script-output`, `warning`,
`workspace-completed`, `"failed"`, `"completed"`. Emit `"completed"` or `"failed"` once
per invocation. Include operation/input identifiers where several files are
involved. Flush records as events arrive; buffering the whole run and splitting
a JSON array into lines is not streaming.

Drain child stdout and stderr concurrently to avoid pipe deadlocks. In machine
mode, script text belongs inside escaped JSON strings; it must never be written
directly to stdout. Apply backpressure, cap retained output and expose
truncation explicitly. Line breaks, tabs, ANSI bytes, Unicode and arbitrary
workspace names must remain valid encoded data. Binary output needs an explicit
byte encoding or a documented replacement policy.

Machine stderr contains one compact diagnostic JSON object per line.
Parse/validation failures before work leave stdout empty and return 2 or 1
respectively. A partial load emits a partial/failure result describing completed
work and returns 1; do not claim rollback unless it occurred. Human-mode
diagnostics remain readable text. Interruptions should stop scheduling new work,
drain or close owned streams, release owned process handles, and return 130
without killing unrelated tmux sessions.

If publishing a native .NET load's final JSON/NDJSON result fails or is
interrupted, the stderr diagnostic includes completed workspace effects.
Those completed changes remain in tmux; an output failure does not imply
rollback.

## Prompts and file writes

Machine mode resolves choices from arguments and never treats missing input as
yes. Detached loading avoids mixing terminal attachment with JSON. Interactive
editor and REPL display require a separate controlling terminal; otherwise the
command rejects the request before execution.

The native contract defines explicit save, format, and overwrite controls for
conversion/import automation. With no destination, machine conversion returns
the document and writes no guessed file. Existing files require explicit
overwrite authorization, including explicit freeze destinations. These rules
differ from the Python overwrite behavior documented by
[freeze](../../cli/freeze/) and [convert](../../cli/convert/).

## Semantic color

Use roles at the point that a domain value is rendered. Formatting an entire
line with one success color loses the structure the requested style should
communicate. Compose a status, subject, identifiers, paths, counts and hints
separately, and reset styling after every token.

| Role | Default tmuxp-aligned style | Typical values |
| --- | --- | --- |
| Heading | Bold bright cyan | Command and section headings |
| Primary subject | Bold magenta | Workspace/session name, selected window |
| Information | Cyan | Paths, targets, useful values |
| Success | Green | Created, loaded, saved |
| Warning | Yellow | Partial support, lossy capture, retained objects |
| Error | Red | Failed operation, invalid field |
| Secondary text | Blue or dim text, verified against terminal contrast | Sizes, timestamps, source labels, hints |
| Command syntax | Distinct option/argument roles from the same theme | Flags, metavariables, examples |

Copy tmuxp's policy explicitly: nonempty `NO_COLOR` disables; explicit never
disables; explicit always enables; nonempty `FORCE_COLOR` enables auto;
otherwise use the destination stream's terminal capability. To support the
supplied reports' extra variables, add `CLICOLOR_FORCE` and `CLICOLOR` below
those explicit/reference choices. `CLICOLOR_FORCE=0` does not force. Machine
mode takes precedence over all color choices, including forced color.

Measure layout using visible terminal width, not byte length or ANSI-bearing
string length. Exercise narrow terminals, wrapped paths, Unicode and redirected
output. Keep status words and labels even when color is enabled, so meaning
survives monochrome output. Progress updates belong on stderr, animate only on a
terminal, and become discrete records in NDJSON mode. Honor the reference
progress presets, custom tokens and panel-line rules.

Native .NET human load draws progress on stderr on Linux x64. With the panel
disabled, decoded script stdout and stderr retain their original destinations.
Resizing stops drawing and leaves the old frame in place. See
[load](../../cli/load/#progress-and-script-output) for native counters and
progress settings.

## Related reference

See [exit codes](../exit-codes/), [command flags](../../cli/), and
[environment](../../configuration/environment/).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
