---
title: "Exit codes and errors"
description: "Observed Python exit behavior and the proposed native error contract."
port: cxx
product: workspace
sidebar:
  label: "Exit codes and errors"
  group: "Reference"
  order: 28
tableOfContents: true
---

**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../compatibility/) describes this port's implemented coverage.

Python tmuxp uses 0 for success, 1 for general failures, and 2 for argument
usage errors. Those categories do not guarantee every current command propagates
every underlying error.

## Current exceptions

`edit` ignores the editor child's status. Machine `search` can return normally
with no output for an invalid regular expression, and with human help for a
missing query. Both import children exit 2 when their source argument is
missing. See their command pages before treating status alone as proof of
success.

The root entry point checks for a supported tmux executable before parsing
arguments, including help. Missing or unsupported tmux can print a diagnostic
and exit with status 0. `tmuxp freeze` also catches a missing-session error, prints
it, and returns normally. These are current implementation quirks.

## Proposed native behavior

Parse errors return 2 before backend work. Input validation or execution
failures return 1. A partial operation includes completed work and the failed
stage in its result and returns 1; it must not claim rollback unless rollback
occurred. An interruption returns 130 after owned streams and handles are
cleaned up, without killing unrelated tmux sessions.

Machine errors on stderr are compact JSON objects, one per line. Parse or
validation failures before work leave stdout empty. Human errors stay readable
text. Stable error codes complement readable messages; native exception objects
and stack traces are not the public JSON schema.

## Machine error codes

In `--json` and `--ndjson` mode an error record on stderr is
`{"schema_version": 1, "code": ..., "message": ...}`, and every entry of a load
summary's `errors` array carries the same `code`. The seven native ports report
the same code for the same condition:

| Condition | Code |
| --- | --- |
| Workspace file or name not found | `workspace_not_found` |
| Malformed document, wrong type, or invalid value | `invalid_workspace` |
| An unknown or unsupported key refused | `unsupported_key` |
| tmux missing, or its server unreachable | `tmux_unavailable` |
| A tmux command failed while building | `tmux_failed` |
| `before_script` exited nonzero, or could not start | `script_failed` |
| A target session does not exist | `session_not_found` |
| A destination exists without `--force` | `destination_exists` |
| A confirmation is needed but impossible | `confirmation_required` |
| Interrupted by a signal | `interrupted` |
| Arguments or mode misused | `usage`, with status 2 |

Other conditions keep port-specific codes, in lower snake_case. Match on the
code, not the message.

See [output](../output/), [automation](../../guides/automation/), and
[troubleshooting](../../guides/troubleshooting/).

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
