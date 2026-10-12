---
port: "kotlin"
route: "topics/ownership"
title: "Client ownership and captured state"
description: "Keep the daemon, wrapper, Java client, and captured values in their proper scopes."
sidebar: {"label": "Client ownership and captured state", "group": "Topics", "order": 2}
tableOfContents: true
---

A Kotlin server scope owns client resources. It does not imply ownership of an
existing tmux daemon. End the client scope when your work finishes, and remove
server-side resources only when your application owns them.

## Wrappers preserve the underlying handle

The Kotlin `Server`, `Session`, `Window`, and `Pane` types wrap Java handles.
Their `asJava` property returns that same underlying object. It is not a detached
copy and does not extend the client's lifetime.

`Server.fromJava` wraps an existing Java server. Closing that wrapper also closes
the underlying server client. A caller that intends to borrow it must therefore
coordinate with the existing owner rather than placing it in an unrelated cleanup
scope. This differs from merely reading captured data.

## Read captured values without hidden I/O

An object's captured ID, name, or size is a regular property. Reading it does not
suspend or contact tmux. Operations that can perform I/O are suspend functions.
Local collection filtering does not refresh its elements.

A new capture observes new state. Keep one capture for a related set of local
decisions and refresh deliberately before a decision that needs current topology.
A window linked into several sessions can have multiple occurrences; choose
physical identity or placement according to the operation you intend.

## Keep resources inside their owner

Use [`withServer`](../../reference/io-github-libtmux-kotlin-withserver/) for a
bounded client lifetime and
[`withControl`](../../reference/io-github-libtmux-kotlin-withcontrol/) for an
explicit control attachment. Finish child work and release observations before
closing their client. Retaining a wrapper reference does not keep a closed
transport usable.

The [transport examples](../../concepts/transports/) exercise command and control
scopes against an isolated fixture. The
[coroutines guide](../../guides/coroutines/) describes Java interoperation and
the wrapper's execution policy in detail.
