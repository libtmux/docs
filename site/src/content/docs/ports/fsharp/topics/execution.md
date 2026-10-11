---
port: "fsharp"
route: "topics/execution"
title: "Tasks, cancellation, and retry"
description: "Retain native dispatch certainty when awaiting tasks or deciding whether to retry."
sidebar: {"label": "Tasks, cancellation, and retry", "group": "Topics", "order": 3}
tableOfContents: true
---

The F# companion's asynchronous contract is a .NET task with an explicit
cancellation token. Calling the operation starts it. This differs from constructing
an F# async workflow, which starts when run.

## Preserve the native cancellation result

Await the task directly when its cancellation details matter. Routing it through
`Async.AwaitTask` and `Async.StartAsTask` can replace the core cancellation
exception and lose evidence such as whether a command may have executed.

A per-call cancellation token bounds the caller's operation. A connection or
handle command timeout bounds individual commands. Neither establishes that a
mutation was never dispatched. Inspect the native error and its dispatch evidence.
The [interop guide](../../guides/interop/) explains the distinction.

## Retry the operation you actually attempted

| Failure pattern | What it says |
| --- | --- |
| [`TmuxFailure.NotSent`](../../reference/libtmux-fsharp-tmuxfailure-notsent-_/) | The failed command did not reach tmux. |
| [`TmuxFailure.Ran`](../../reference/libtmux-fsharp-tmuxfailure-ran-_/) | tmux ran the command and returned an error or unusable answer. |
| [`TmuxFailure.MayHaveRun`](../../reference/libtmux-fsharp-tmuxfailure-mayhaverun-_/) | The effect can be uncertain after failure or cancellation. |

One command that was not sent does not prove that an entire multi-step operation
had no effect. An attempt might create a window and fail before sending its next
command. `Retry.ifNotSent` accounts for commands across the attempt and repeats
it only when none reached tmux.

Choose any broader retry policy only when the application's operation is safe to
repeat. Do not turn a timeout into automatic mutation replay.

## Choose a call, chain, or control client

Use an individual typed operation when its returned handle is needed by the next
step. A command chain is built without I/O and dispatched explicitly; it returns
combined command output rather than a typed object for every step. A control
client provides a persistent command and notification connection with a separate
lifetime.

Bound concurrent reads instead of starting an unbounded input with `Task.WhenAll`.
Keep dependent mutations in order, and pass cancellation through queued as well
as active work.

The [execution-mode guide](../../guides/modes/) covers chains and bounded captures.
The [transport examples](../../concepts/transports/) provide executable programs
with explicit cancellation and cleanup.
