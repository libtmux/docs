---
port: "scala"
route: "topics/execution"
title: "Effects, admission, and cancellation"
description: "Distinguish immediate calls from repeatable effects and bound admitted work."
sidebar: {"label": "Effects, admission, and cancellation", "group": "Topics", "order": 3}
tableOfContents: true
---

Direct Scala operations execute immediately. Cats operations construct lazy
effects: creating an effect performs no tmux I/O, and evaluating it again repeats
the operation. Reusing a mutation effect is therefore a decision to repeat work,
not to reuse an earlier result.

## Captured values stay local

Captured information, relationships, and immutable collection filtering are pure
reads in both facades. A subsystem accessor can also be local while its later
operations perform I/O. Listing fresh state, refreshing a handle, format expansion,
and mutations require execution.

Use the [query concepts](../../concepts/queries/) for local selection and the
[execution guide](../../guides/execution/) for effect boundaries. A filtered
collection retains its capture; filtering does not make it current.

## Bound submissions and admission

Cats command work crosses an interruptible blocking boundary. A concurrency limit
bounds admitted calls, not the number of fibers your application may queue and
not all memory used by transport workers. Use bounded traversal for a large input
collection.

A wait that depends on another command must leave capacity for the command that
can release it. The facade's waiting operations reserve such capacity; respect
their documented minimum rather than sharing an exhausted pool with the producer.

Ordered traversal can preserve the order of returned results while concurrent
mutations reach tmux in a different order. Keep dependent mutations sequential.
A Java command timeout begins after Scala admission; an effect timeout can cover
waiting for admission too, while cleanup may still take additional time.

## A canceled effect may have dispatched

Cancellation interrupts local work and waits for cleanup. It does not undo a
mutation, kill a daemon-side shell job, or trigger an automatic retry. The
underlying dispatch state distinguishes a command that was not sent from one
whose effect is unknown.

A control acknowledgement confirms a protocol reply. Deferred work can still be
running. Use a separate completion signal for the application-level task, and a
separate attachment if its observation must survive command cancellation.

The [execution guide](../../guides/execution/) describes the observer used to
inspect dispatch outcomes and the exact admission rules. The
[complete transport programs](../../concepts/transports/) show cleanup around
both command calls and persistent control clients.
