---
port: "julia"
route: "topics/execution"
title: "Execution and cancellation"
description: "Choose a transport and interpret completion, cancellation, and partial effects."
sidebar: {"label": "Execution and cancellation", "group": "Topics", "order": 3}
tableOfContents: true
---

Julia's remote operations return ordinary results. Use a task when your program
needs concurrency, and fetch its result so failures remain visible. Local
construction, filtering, iteration, and display perform no tmux I/O.

## Select the transport explicitly

| Choice | Guarantee and limit |
| --- | --- |
| `Server` | Uses subprocess operations with best-effort daemon-generation checks; a check/use interval remains. |
| `ControlConnection` | Stays bound to its daemon and becomes terminal on connection loss. It does not reconnect and replay mutations. |
| `strict=true` on applicable server operations | Refuses unsupported subprocess generation semantics before execution. |

Unsupported routes do not fall back silently. For example, control mode supports
environment writes but refuses environment reads whose full presence and origin
metadata cannot be represented. Choose an explicit server read only when its
identity semantics meet your needs.

The [ownership and I/O topic](../ownership/) contains the full operation matrix.
A callback-scoped control client is still an observable attachment to tmux;
client counts, hooks, and sizing policies remain relevant.

## Cancellation is not rollback

A cancellation observed before submission sends nothing. After submission, the
command may already have effects. A canceled wait can return while a control
ledger slot remains occupied until the backend reply is retired. Do not equate
returning from cancellation with every backend resource becoming immediately free.

The default timeout on typed server operations is one finite budget covering
validation, acquisition, and command I/O. An operation-specific signature can have
additional controls. Use the [cancel-control-wait example](../../examples/cancel-control-wait/)
to exercise cancellation without closing its connection.

## Batch and group results mean different things

`run_batch` runs independent commands and continues after an item fails. Results
retain input order even when execution order differs. `run_group` submits an
explicit semicolon group; a failure can skip a suffix, and successful earlier
effects remain. Inspect each item's completed, failed, skipped, or unknown
status. Neither form is a transaction.

A control reply frame is not sufficient evidence that every deferred side effect
has finished. Control capture uses a same-queue fence to establish completion of
its owned file write. That capture path requires the daemon and caller to share
the local filesystem, and the write can block tmux's event loop.

## Choose an application-level signal

Terminal echo establishes that bytes were echoed, not that an application started
or finished. A screen baseline and a future-byte stream also have an explicit
reset boundary rather than an atomic relationship. The
[observation topic](../observations/) and
[complete output program](../../examples/observe-output/) show the distinction.

Close clients and observations deterministically. If the callback and cleanup
both fail, retain both entries of the resulting composite exception rather than
reporting the operation as successful.
