---
port: "fsharp"
route: "topics/ownership"
title: "Native identity and ownership"
description: "Use the same .NET entities while making resource ownership explicit."
sidebar: {"label": "Native identity and ownership", "group": "Topics", "order": 2}
tableOfContents: true
---

F# helpers operate on native .NET servers, sessions, windows, panes, requests,
and exceptions. Passing an entity between F# and C# does not require a conversion
or a second object model.

## Captured identity is retained

Local sequence operations select existing objects; they do not reacquire them.
Keep a single capture for a related set of decisions, and acquire new state
explicitly when freshness matters. A missing completed lookup can be represented
by an option. An acquisition failure remains an error, not a missing value.

Use `Selection.exactlyOne` when zero and multiple local matches need distinct
outcomes. See [query concepts](../../concepts/queries/) and the
[query guide](../../guides/queries/) for the selection rules.

## Own clients separately from daemons

| Operation | Ownership |
| --- | --- |
| `Control.withSession` | Owns a control client for one task. |
| `Control.enter` or `Control.enterSession` | Returns a client whose caller must arrange disposal. |
| `Control.useSession` | Transfers a supplied client's lifetime into the task scope. |
| `Control.foldWhile` or `Control.iter` | Borrows the client and disposes its own event enumerator. |

Ending a control-client scope does not grant permission to kill the tmux daemon.
When an example creates sessions on a private endpoint, it can remove those
resources as part of its own cleanup. An application connecting to an existing
server must leave that server's lifetime with its owner.

## Keep the useful failure

If an event callback and enumerator cleanup both fail, the callback exception
propagates with its original type. `Control.cleanupFailure` exposes the cleanup
failure as well. This lets a handler still match the original core exception
without silently discarding the release error.

The [stream guide](../../guides/streams/) describes consumer lifetimes and the
[.NET interoperation guide](../../guides/interop/) covers native types and
exceptions. The [transport examples](../../concepts/transports/) put acquisition,
use, and cleanup together in complete programs.
