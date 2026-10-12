---
port: "scala"
route: "topics/ownership"
title: "Client and effect lifetimes"
description: "Choose an owner for Java handles and keep work inside the effect resource."
sidebar: {"label": "Client and effect lifetimes", "group": "Topics", "order": 2}
tableOfContents: true
---

Opening a Scala server owns a Java client. Closing it releases transport and
local workers. Killing the tmux daemon is a separate operation and requires a
separate ownership decision.

## Direct and effect scopes differ

| Facade | Lifetime |
| --- | --- |
| Direct `Server.open` | Use `Using.resource` or an explicit cleanup scope. |
| Direct `Server.fromJava` | Wraps the same Java client; closing the facade also closes that client. |
| Cats `Server.resource` | Acquires and closes its owned client within a `Resource`. |
| Cats `Server.fromJava` | Scopes facade work while leaving the borrowed Java client with its existing owner. |

Do not infer borrowing behavior from the method name alone. In particular, direct
facade closure and release of a borrowed Cats resource have different effects.
The [ownership guide](../../guides/ownership/) specifies both contracts.

## Captured data outlives an operation

Direct handles are opaque over their Java objects. They do not make another
copy of entity identity. `asJava` exposes the same handle, with the same ownership
and threading obligations.

Captured fields remain observations you can inspect locally. Keeping a handle or
an unevaluated effect after a resource body returns does not extend the resource's
lifetime. Executing work through the released effect facade fails.

Cats release rejects new work, cancels queued and running operations, waits for
finalizers, and then closes an owned client. Borrowing changes who closes the
Java client; it does not remove cleanup of the facade's own work.

## Attachments and observations have their own scopes

An attached control client owns a separate process attachment. Acquire an
observation inside that attachment and release it first. Use separate attachments
when command cancellation must not end an observation.

A raw Java handle obtained inside an owned scope cannot keep that scope alive.
If an external owner closes a borrowed transport while a request is running,
preserve the resulting dispatch uncertainty. Do not convert it to a successful
empty result or replay the operation automatically.

Run the [transport examples](../../concepts/transports/) and read the
[ownership guide](../../guides/ownership/) for the native resource boundaries.
