---
description: Python output and the native CLI stream and color contract.
product: workspace
sidebar:
  group: Reference
  label: JSON, NDJSON, and semantic color
  order: 29
tableOfContents: true
title: JSON, NDJSON, and semantic color
---

<!-- port:py -->This page documents the available Python tmuxp reference. Proposed native
extensions are labeled separately.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../compatibility/) describes this port's implemented coverage.
<!-- /port -->
**Native CLI development contract.** The local `workspace-cli` worktrees provide JSON and NDJSON output. The schema below is the shared target; implemented command coverage remains port-specific. Python tmuxp provides JSON and NDJSON on `ls` and `search`, and JSON on `debug-info`.

## Format selection

The shared contract accepts `--json` and `--ndjson` before or after every leaf command.
NDJSON wins when both are present. A saved workspace's encoding is separate:
`freeze -f yaml` describes the file, while `--json` describes the CLI result
stream. Machine output has no ANSI styling, prompts, spinner frames, or raw
child output.
<!-- port:go,dotnet,cxx,swift -->
<!-- /port --><!-- port:go -->## Native Go logging
<!-- /port --><!-- port:dotnet -->The native .NET CLI disables machine styling and progress, but .NET Console
initialization can still emit keypad controls when stdout is a terminal. Use
redirected stdout for machine consumption. Console writes do not provide a
hard cancellation deadline.
<!-- /port --><!-- port:cxx -->## Native C++ load output
<!-- /port --><!-- port:swift -->## Native Swift child output
<!-- /port --><!-- port:go,dotnet,cxx,swift -->
<!-- /port --><!-- port:go -->The native Go CLI uses `--log-level` to filter optional diagnostics and
structured `--log-file` output on Unix. Levels are `debug`, `info`, `warning`,
`error` and `critical`; the default is `warning`. Mandatory command errors,
results and NDJSON operation events remain visible at every level.
<!-- /port --><!-- port:dotnet -->For native .NET commands, `--log-level debug|info|warning|error|critical`
filters optional warnings and file records; the default is `warning`. It does
not suppress command errors or JSON/NDJSON result events.
<!-- /port --><!-- port:cxx -->Human load publishes its summary and flushes stdout and stderr before terminal
attachment or client switching. A handoff failure preserves loaded changes.
If final publication fails, a writable diagnostic stream reports the completed
summary under `retained_state`; human stderr labels the same observed state.
A previous nonzero load status survives a later output failure.
<!-- /port --><!-- port:swift -->The native Swift command streams `before_script` and captured `shell -c`
output while the child runs. Human bootstrap output keeps its original stdout
or stderr destination. Human shell output also preserves line breaks and tabs,
escaping other terminal controls.
<!-- /port --><!-- port:go,dotnet,cxx,swift -->
<!-- /port --><!-- port:go -->`--log-file` appends UTF-8 JSON lines to a regular file. The CLI checks the
destination before starting Python or tmux. A new file requests owner-only
read/write permissions, subject to the process umask; existing content and
permissions are preserved. A final-path symlink, FIFO, device or directory is
rejected. Log files are unsupported on non-Unix platforms.
<!-- /port --><!-- port:dotnet -->On Linux x64, native `load --log-file PATH` appends UTF-8 JSON lines without
terminal colors. Select `info` for lifecycle records or `debug` to include
script output. Relative paths use the invocation directory. New files allow
only owner read/write; existing content and permissions are preserved.
Directories, pipes, devices and symbolic links are rejected before tmux or
Python runs. Other platforms reject `--log-file`.
<!-- /port --><!-- port:cxx -->Closed event output while building retains completed inputs and borrowed-session
effects in the failure summary. A known script failure keeps its status and
captured output when its completion event cannot be delivered. Scripts can make
additional changes outside the builder's retained-window records. NDJSON can
emit its terminal result only while its output stream remains writable. See
[loading and attachment](../../cli/load/#native-c-loading) for terminal and
client requirements.
<!-- /port --><!-- port:swift -->In JSON and NDJSON modes, child chunks are warning records on **stderr** with
codes `bootstrap_stdout`, `bootstrap_stderr`, `shell_stdout` or `shell_stderr`.
`--log-level error` and `critical` hide those warnings. Load events and results
stay on stdout; the final shell result retains complete captured stdout/stderr
and the child exit status even when warnings are hidden.
<!-- /port --><!-- port:go,dotnet,cxx,swift -->
<!-- /port --><!-- port:go -->The log includes lifecycle records at `info` and script stream text at `debug`.
Lifecycle summaries omit script bodies. If writing or closing the log fails,
logging stops and the CLI attempts at most one optional warning after work and
terminal cleanup. The primary result, child exit status or cancellation status
is preserved even if that warning cannot be written. This does not impose a
filesystem write deadline or resolve every command-output failure path.
<!-- /port --><!-- port:cxx -->## Native C++ logging
<!-- /port --><!-- port:swift -->Each child stream is limited to one MiB. UTF-8 characters split across reads
are retained until complete; invalid bytes use replacement characters. Output
follows sink backpressure without replaying previous chunks. Overflow, failed
writes and cancellation terminate the captured process group; a closed reader
is detected on the next pending write.
<!-- /port --><!-- port:go,cxx,swift -->
<!-- /port --><!-- port:go -->## Native Go load failures
<!-- /port --><!-- port:cxx -->`load --log-file PATH` appends one JSON diagnostic record per line. The global
`--log-level` defaults to `warning`; `info` includes lifecycle events and `debug`
adds script-output chunks. Other records omit structured script captures.
Required errors and primary JSON/NDJSON results remain visible at every level.
<!-- /port --><!-- port:go,cxx -->
<!-- /port --><!-- port:go -->After processing an input, native load retains its observed summary for failure
reporting. If final output fails or publication is interrupted, a writable
machine diagnostic stream includes that summary under `result`. Human stderr
lists observed session IDs and stages. These records describe the loading
outcome; they do not recheck whether each session is still alive.

A successfully built workspace can have `result.status: "ok"` when publication
is interrupted and the command returns 130. A failed before script still removes
its newly created session when the script-completion event cannot be written.
Borrowed sessions survive; an output failure after a successful script also
retains its session. Other effects before an input returns from building need
separate coverage.
<!-- /port --><!-- port:dotnet -->Failure to open the log prevents execution. A later write or close failure
disables logging and reports at most one secondary warning; the workspace
result, original error or cancellation is preserved. Python delegation leaves
the file under native ownership, but still delegates the whole load and lacks
native per-input accounting.
<!-- /port --><!-- port:cxx -->The destination must be a regular file. New files receive owner-only
permissions; existing contents and permissions are preserved. Invalid paths,
symlinks and non-regular destinations fail before backend mutation. A later
write failure disables the file and reports one optional warning after primary
output checks. It preserves child status, cleanup and terminal handoff, but can
leave an incomplete final log record.
<!-- /port --><!-- port:swift -->On cancellation, load attempts one terminal failure result and fatal diagnostic
with bounded writes. Writable stdout receives the terminal result; blocked or
closed output cannot guarantee delivery. A diagnostic interrupted on blocked
stderr may end mid-record. SIGINT and SIGTERM return status 130, and append
failures preserve the borrowed session.
<!-- /port -->
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
<!-- port:py,ts,rs,go,java,dotnet,cxx -->| `"shell"` | For `-c`, one result containing captured Python stdout/stderr and child status. Interactive REPL requires a separate terminal; otherwise reject before execution. | For `-c`, stream captured Python output events and one terminal result. Interactive behavior has the same terminal requirement. |
<!-- /port --><!-- port:swift -->| `"shell"` | For `-c`, one result containing captured Python stdout/stderr and child status. Native Swift machine calls require `-c`. | Native Swift writes one terminal result to stdout; live child warnings use stderr as described above. |
<!-- /port -->
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

<!-- port:ts,rs,go,java,dotnet,cxx,swift -->Every result names `input`, `input_index`, `session_id`, `session_name` and
`reused`; ports add their own fields around those. An input that failed keeps
its result record beside its `errors` entry, so a reader can tell which input
failed and what became of its session. `status` is `ok` when every input
completed, `partial` when some input completed or a failed one left effects
behind, such as a borrowed or appended session, and `error` when nothing
completed and nothing was retained.

<!-- /port --><!-- port:ts -->TypeScript Python-extension loads report `effects_scope: "observed"` and
`effects_unknown: true`, with `observed_windows` and `observed_panes` listing
newly observed IDs. These lists may include concurrent changes and do not prove
ownership. The CLI does not roll back extension effects; a failed or interrupted
extension can leave a partial result. A daemon change is reported without
comparing IDs across its lifetimes. Captured `script_output` retains up to
64 KiB of source bytes per stream and reports truncation; NDJSON forwards
escaped `script-output` records as output arrives.

<!-- /port -->NDJSON operation events have `schema_version`, `"command"`, `event`, a
monotonically increasing `"sequence"`, and event-specific data. The initial
vocabulary is `started`, `workspace-started`, `session-created`,
`window-created`, `pane-created`, `script-output`, `warning`,
`workspace-completed`, `"failed"`, `"completed"`. Emit `"completed"` or `"failed"` once
per invocation. Include operation/input identifiers where several files are
<!-- port:py -->involved. Flush records as events arrive; buffering the whole run and splitting
a JSON array into lines is not streaming.
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->involved. `workspace-started` names the `input` and `input_index` it belongs to,
and `session-created` follows it directly, before any `window-created`, so a
reader knows the session a window belongs to as soon as the windows arrive.
Flush records as events arrive; buffering the whole run and splitting a JSON
array into lines is not streaming.
<!-- /port -->
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

<!-- port:rs -->## Native Rust load reporting

If publishing a load result fails, the local Rust CLI reports completed inputs
and observed tmux effects on stderr. Machine diagnostics include this summary
in `retained_state`; human diagnostics print it after the error. The CLI does
not roll back loaded sessions or append changes when result output fails.

A nonzero `before_script` exit status already collected by the CLI survives a
later result publication failure. This guarantee does not cover Ctrl-C or
failures before the child runner returns its captured output and status.

## Native Rust logging

The local `tmux-workspace load --log-file PATH` appends JSON records to a
regular file. New files have owner-only permissions; existing contents and
permissions are preserved. Invalid destinations, including symlinks, are
rejected before tmux or Python runs.

The default `--log-level` is `warning`. `info` includes load events; `debug`
also records child output, capped at 1 MiB of decoded UTF-8 per stream per
child with truncation marked. Lifecycle records omit captured streams,
including nested result captures; diagnostic messages are preserved.

A later file-write failure disables logging. Its optional warning follows the
command result or error; levels above `warning` suppress it. Log filtering
does not suppress command errors or change their exit statuses.
<!-- /port --><!-- port:dotnet -->If publishing a native .NET load's final JSON/NDJSON result fails or is
interrupted, the stderr diagnostic includes completed workspace effects.
Those completed changes remain in tmux; an output failure does not imply
rollback.
<!-- /port --><!-- port:rs,dotnet -->
<!-- /port -->## Prompts and file writes

Machine mode resolves choices from arguments and never treats missing input as
yes. Detached loading avoids mixing terminal attachment with JSON. Interactive
editor and REPL display require a separate controlling terminal; otherwise the
command rejects the request before execution.

<!-- port:py -->The proposal adds explicit save, format, and overwrite controls to
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->The native contract defines explicit save, format, and overwrite controls for
<!-- /port -->conversion/import automation. With no destination, machine conversion returns
the document and writes no guessed file. Existing files require explicit
<!-- port:py -->overwrite authorization, including explicit freeze destinations. These are
proposed improvements over the Python overwrite behavior documented by
<!-- /port --><!-- port:ts,rs,go,java,dotnet,cxx,swift -->overwrite authorization, including explicit freeze destinations. These rules
differ from the Python overwrite behavior documented by
<!-- /port -->[freeze](../../cli/freeze/) and [convert](../../cli/convert/).

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

<!-- port:dotnet -->Native .NET human load draws progress on stderr on Linux x64. With the panel
disabled, decoded script stdout and stderr retain their original destinations.
Resizing stops drawing and leaves the old frame in place. See
[load](../../cli/load/#progress-and-script-output) for native counters and
progress settings.

<!-- /port -->## Related reference

See [exit codes](../exit-codes/), [command flags](../../cli/), and
[environment](../../configuration/environment/).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
