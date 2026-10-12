---
port: "powershell"
route: "topics/execution"
title: "Dispatch, completion, and failure"
description: "Distinguish accepted input, tmux replies, shell completion, and application readiness."
sidebar: {"label": "Dispatch, completion, and failure", "group": "Topics", "order": 3}
tableOfContents: true
---

Choose the completion signal that answers your actual question. A successful
key-send operation means tmux accepted input. It does not establish that a shell
command or service has finished.

## What a result proves

| Task | Evidence to use |
| --- | --- |
| Send key tokens to a pane | `Send-TmuxKey` reports the input operation's result. |
| Run a shell command and inspect its exit status | `Invoke-TmuxPaneCommand` waits for authenticated completion. |
| Wait for a service to announce readiness | `Wait-TmuxPaneText` observes the stated text condition; check service behavior separately. |
| Send a control command | `Invoke-TmuxControlCommand` returns the command reply; deferred work may continue. |
| Submit a known sequence of tmux commands | `Invoke-TmuxChain` dispatches the chain in order. |

The [command-completion example](../../examples/command-completion/) checks
exit status 7. A nonzero shell exit is a result, not automatically a tmux error.
The [service example](../../examples/wait-for-service/) checks a readiness line
and then makes an HTTP request. Seeing echoed input alone proves neither result.

## Commands and chains

`New-TmuxCommand` creates an inert command value with literal argument boundaries.
Arguments can still invoke tmux features that run shell programs; literal argv
handling does not change the semantics of those features.

A chain retains guards carried by its typed commands. It returns combined output,
not an individual receipt for every step. A failure can skip later commands while
leaving earlier changes in place. A chain is not a transaction.

Use individual typed operations when later steps need newly acquired object
handles. Use bounded concurrent work only for operations whose independence you
have established. Result ordering does not imply dispatch ordering.

## Stopping the caller does not undo dispatch

Ctrl+C cancels a current wait. A dispatched command may continue, and a timeout
may leave its effect uncertain. The library does not make cancellation a rollback
or a reason to retry a mutation automatically.

PowerShell's error policy also matters: the default continuing behavior can allow
later input owners to be processed, whereas `-ErrorAction Stop` terminates the
pipeline on the reported failure. Keep the original native exception and its
available dispatch evidence when reporting the failure.

The [command guide](../../guides/commands/) covers transport and batch limits.
The [input guide](../../guides/input/) specifies completion, timeout, and key-send
behavior for each operation.
