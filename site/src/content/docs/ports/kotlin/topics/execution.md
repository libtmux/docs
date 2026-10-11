---
port: "kotlin"
route: "topics/execution"
title: "Coroutines and command execution"
description: "Choose bounded coroutine work and preserve uncertainty after cancellation."
sidebar: {"label": "Coroutines and command execution", "group": "Topics", "order": 3}
tableOfContents: true
---

A suspend function does not select control mode. Ordinary Kotlin operations use
the configured command transport; opening a persistent control client is an
explicit choice.

## Suspending and captured operations

| Operation | Execution boundary |
| --- | --- |
| Captured name, ID, size, or local selection | A local value; no tmux request. |
| A suspending read or mutation | Command work through `ExecutionPolicy.commands`. |
| The background pump for `Server.liveState` | Blocking reads through `ExecutionPolicy.streamReads`. |
| `ControlClient.output` and `ControlClient.events` | Collected through subscription polling and readiness callbacks. |

The command pool is sized from the server configuration's command-admission
bound. A coroutine call still ultimately invokes blocking Java I/O; the wrapper
uses an interruptible boundary so the caller's coroutine does not block an
arbitrary application thread.

Bound the work you submit as well as the transport's admission. Starting an
unbounded number of coroutines can create a large waiting population even when
only a few commands run at once. Independent reads can run concurrently; a
sequence whose second operation depends on the first must retain that ordering.

## Cancellation ends waiting, not history

Cancellation interrupts the wrapper's wait. It cannot undo a command already
sent to tmux. A timeout therefore does not prove a mutation had no effect.
Preserve the underlying failure and any dispatch information before deciding
whether another attempt is safe.

Likewise, sending terminal input is distinct from waiting for a shell command or
application to finish. Use an operation with the required completion contract,
or an application-level readiness check. Echoing the supplied text alone is not
that evidence.

Use the [command and control programs](../../concepts/transports/) to compare
client scopes. The [coroutines guide](../../guides/coroutines/) explains the two
execution pools and the nonblocking subscription path; the
[API reference](../../reference/) gives each operation's contract.
