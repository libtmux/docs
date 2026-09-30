---
title: Exit codes and errors
description: Use process status and structured error codes to handle workspace failures.
product: workspace
sidebar:
  label: Exit codes and errors
  group: "Reference"
  order: 28
tableOfContents: true
---

<!-- port:py -->
tmuxp generally uses `0` for success, `1` for operation failures and `2` for
argument errors. Some commands have exceptions at this documented revision.

## Exceptions to check

- `edit` does not propagate the editor child's status.
- Machine `search` can return normally with no output for an invalid pattern;
  a missing query can show human help.
- A missing import source exits with status `2`.
- A missing or unsupported tmux executable can print a diagnostic and return
  status `0` before argument parsing.
- `freeze` can catch a missing-session error, print it and return normally.

Read both the command's output and [reference page](../../cli/) before using
its status as the only success check.

[Command source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
<!-- /port -->

<!-- port:ts,rs,go,java,dotnet,cxx,swift -->
Check the process status before treating a result as complete. A failed load
can report retained effects; a later failure does not undo an earlier input.

| Exit status | Meaning |
| --- | --- |
| `0` | Command completed; an explicitly declined prompt can also finish without changes |
| `1` | Workspace validation or operation failure |
| `2` | Invalid arguments or execution context |
| `130` | Interrupted operation |

Child commands such as `edit` can propagate another nonzero child status.
<!-- port:dotnet -->
Status `70` reports an internal error.
<!-- /port -->
<!-- port:cxx -->
Termination by SIGTERM can return `143`.
<!-- /port -->

## Machine errors

With `--json` or `--ndjson`, diagnostics identify a `code` and readable
`message`. Use the code for program decisions and keep the message for users.

| Code | Condition |
| --- | --- |
| `workspace_not_found` | Requested workspace was not found |
| `invalid_workspace` | Document shape or value is invalid |
| `unsupported_key` | An execution field is unsupported |
| `session_not_found` | The selected session does not exist |
| `session_mismatch` | Existing session does not match the requested document |
| `tmux_unavailable` | tmux cannot be found or used |
| `tmux_failed` | A tmux operation failed |
| `script_failed` | A bootstrap process failed |
| `destination_exists` | A file would be replaced without authorization |
| `usage` | Arguments or execution context are invalid |
| `interrupted` | A signal stopped the operation |

Additional codes describe implementation failures such as a closed output
stream, unavailable runtime or log-file failure. Keep unknown codes visible
instead of assuming they mean success. See [troubleshooting](../../guides/troubleshooting/)
for collecting a useful report.

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
