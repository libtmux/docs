---
port: "scala"
route: "topics/observations"
title: "Observations, gaps, and reconciliation"
description: "Handle FS2 stream ownership and bounded queues without inventing delivery guarantees."
sidebar: {"label": "Observations, gaps, and reconciliation", "group": "Topics", "order": 4}
tableOfContents: true
---

The Cats module adapts Java subscriptions to FS2. Acquire a control attachment,
then an observation, then start the producer. This order avoids asking a newly
created observer to recover an event that happened before it existed.

## One consumer owns an observation

An observation permits one active consumer. A second reader on the same
observation fails. Use an explicit broadcast when multiple parts of the
application need the same delivery, and decide how that broadcast handles its own
slow consumers.

Output values retain their pane identity. Their data is decoded terminal text,
not exact bytes or a captured screen. A text marker can span values, so keep the
necessary matching state across fragments.

## Keep gap information

| Projection | Behavior after subscription loss |
| --- | --- |
| Full delivery stream | Includes `Delivery.Gap` before surviving values. |
| `Observation.value` | Drops gap records. |
| `Observation.kept` | Fails the read when loss is encountered. |

A bounded subscription can discard old values when the reader falls behind.
FS2 demand does not make tmux obey backpressure or retain a durable history.
The cumulative dropped count gives additional loss evidence; closing a
subscription discards its queued values without counting that as overflow.

Take a new snapshot before acting on event-derived topology after loss. That
recovers a current view of objects, not the missing terminal output.

## Interpret the ending correctly

An idle Cats consumer suspends its fiber on the subscription's readiness callback.
The direct-style observation instead blocks in Java for its next delivery.
Canceling a Cats reader releases its consumer slot; releasing the observation
closes the subscription.

Deliberate observation or attachment closure ends the stream. A native client
failure carries its cause. The remaining unknown-cause case is not evidence of a
specific timeout or daemon crash.

See the [streaming guide](../../guides/streaming/) for loss projections and
closure behavior, and [client lifetimes](../ownership/) for nested cleanup.
Use the [capture example](../../examples/capture-pane-output/) when you need the
screen's current contents instead of future event delivery.
