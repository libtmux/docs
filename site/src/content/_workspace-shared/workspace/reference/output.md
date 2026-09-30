---
description: Read JSON results, NDJSON events and diagnostics from the workspace command.
product: workspace
sidebar:
  group: Reference
  label: Output formats
  order: 29
tableOfContents: true
title: Output formats
---

<!-- port:py -->
Choose the output supported by each tmuxp command:

| Command | Machine output |
| --- | --- |
| `ls` | `--json` returns an object containing `workspaces`; `--ndjson` returns records |
| `search` | `--json` and `--ndjson`; read the command's empty-result caveats |
| `debug-info` | `--json` |
| `freeze`, `convert`, imports | YAML or JSON workspace document output, separate from a result protocol |

```console
$ tmuxp ls --json
```

Do not assume every command accepts a global JSON mode. Read the
[command reference](../../cli/) for flags, prompts and destinations, and
[exit codes](../exit-codes/) before interpreting an empty stream as success.

`--color auto|always|never`, `NO_COLOR` and `FORCE_COLOR` control human styling.
Use explicit output formats when a script reads the result.

[Command source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
<!-- /port -->

<!-- port:ts,rs,go,java,dotnet,cxx,swift -->
Every command accepts `--json` and `--ndjson`. JSON writes one document to
stdout. NDJSON writes one JSON record per line and takes precedence if both
flags are present. Machine output contains no terminal styling.

## Choose a stream

```console
$ tmux-workspace ls --json
```

The shape depends on the operation: listing and search describe workspace
records; conversion and import can return the translated document; loading
describes completed work and failures. Saving a document returns information
about that save. The file's YAML/JSON encoding is controlled separately by
`--workspace-format`.

Use [automation](../../guides/automation/) for a detached load and streamed
progress. Read stdout as results and stderr as diagnostics. Check the exit
status even when stdout contains valid data.

## Partial work and interrupted streams

Load results can contain completed inputs, created IDs and retained effects.
Treat a failed operation as partial until its result tells you what remains.
A creation event alone does not establish that the workspace finished.

An output failure or interruption can leave a final record unwritten or
incomplete. A consumer must handle EOF and parse errors. Preserve the exit
status and inspect the private server before retrying mutations.

## Child output and logging

Machine calls encode captured child text so it cannot be confused with result
records. The optional [inspection shell](../../cli/shell/) reports its child
status along with captured output. A nonzero editor status is propagated.

<!-- port:swift -->
Bootstrap and inspection output streams as warning records on stderr, with up
to one MiB per stream. The final result carries captured text. `--log-level`
can filter advisory records; fatal errors and results remain visible.
<!-- /port -->
<!-- port:ts -->
Captured child results retain up to 64 KiB of source bytes per stream and mark
truncation. NDJSON forwards child output as it arrives.
<!-- /port -->
<!-- port:rs,go,java,dotnet,cxx -->
NDJSON can carry child-output records while a command is running. Read the
terminal result and child status after those records.
<!-- /port -->

`load --log-file PATH` appends diagnostics to a separate file. `--log-level`
selects advisory detail. A later log-file failure reports a diagnostic and
preserves the operation's result; the log can end with an incomplete record.

## Human output

`--color auto|always|never` selects styling; nonempty `NO_COLOR` disables color.
Human progress uses the terminal. `--no-progress` disables drawing without
hiding errors. Redirected or machine output avoids the progress display.

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
