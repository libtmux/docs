---
port: "powershell"
route: "topics/ownership"
title: "Ownership and cleanup"
description: "Keep daemon, client, session, and runspace lifetimes explicit."
sidebar: {"label": "Ownership and cleanup", "group": "Topics", "order": 2}
tableOfContents: true
---

A server handle does not own the tmux daemon. Most cmdlets borrow the native
objects supplied to them. Decide who creates and removes each resource before
putting operations in a pipeline or background job.

## Match cleanup to what you created

| Resource | Lifetime rule |
| --- | --- |
| Endpoint from `New-TmuxServer` | A description; constructing it starts no daemon. |
| An existing server or session | Remains under its existing owner's control. |
| A session your example creates | Remove that session in cleanup when its work ends. |
| Client from `Connect-TmuxControl` | Close explicitly with `Disconnect-TmuxControl`. |
| Client created internally by `Watch-TmuxEvent` | The watcher closes it when its reader ends. |
| A thread job you start | Stop and remove the job, including after a failed receive. |

Disconnecting a control client closes that client for every caller sharing it.
It does not mean the daemon should be killed. Cleanup awaits native disposal;
that operation has no cancellation token.

## Use an isolated endpoint for automation

The complete examples choose a unique socket name and a clean tmux configuration.
They remove only the session they create. This makes the resource boundary
visible and avoids attaching an example's lifetime to your interactive server.

Do not treat `-Confirm:$false` as an ownership check. It suppresses a confirmation
prompt; your code must still target the resources it is responsible for.
Keep useful `-WhatIf` behavior in operator-facing scripts.

## Preserve failures during cleanup

Use a `finally` scope to release resources after success, operation failure, or
an early exit. If cleanup fails too, retain both errors rather than replacing the
original failure. The [create-layout program](../../examples/create-layout/)
shows that handling in full.

Module removal ends active watchers in that runspace. It does not close clients
previously returned by `Connect-TmuxControl`. A handle transferred to another
caller therefore still needs an agreed owner.

Thread jobs run in the same process and preserve native objects. Process jobs
serialize output and cannot be used to transfer a live native handle unchanged.
Create and close a client's resources in the worker that uses them when running
independent work. See [runspaces and watchers](../../guides/watch/) for bounded
job recipes and [control clients](../../guides/commands/) for borrowed-client
examples.
