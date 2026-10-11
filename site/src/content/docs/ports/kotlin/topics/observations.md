---
port: "kotlin"
route: "topics/observations"
title: "Flows and event loss"
description: "Collect bounded subscriptions and distinguish state reconciliation from recovering output."
sidebar: {"label": "Flows and event loss", "group": "Topics", "order": 4}
tableOfContents: true
---

A flow of output is an observation of future terminal activity. It is different
from capturing a pane's current screen or retaining a captured object graph.
Choose which one your application needs before choosing a collector.

## Each collection owns a subscription

`ControlClient.output` and `ControlClient.events` are cold flows. Each collection
opens a fresh Java subscription with its own buffer and loss accounting. Two
collectors therefore do not compete for the same subscription's next item.

Acquire the control client and start the intended observation before the producer
whose output or notification matters. Keep the collector within the client's
lifetime. Cancellation releases its readiness callback and subscription work;
closing the client is a separate ownership decision.

## Delivery is bounded

The collector polls its subscription directly and suspends on a one-shot
readiness callback when no item is buffered. An idle event collector does not
occupy a thread in either execution pool. The live-state background pump has a
different execution path; do not transfer that guarantee to every watch API.

A slow collector can overrun its bounded subscription buffer. The subscription
reports that loss as a gap. Preserve those records instead of projecting every
delivery to an ordinary value and losing the evidence that something is missing.
Flow demand does not make tmux a durable, replayable producer.

## Recover according to the question

After a gap, acquire fresh state before acting on a topology derived from events.
A new capture can tell you what exists now; it cannot reconstruct output that
was lost. Text markers can also cross event boundaries, so a consumer must retain
the relevant suffix rather than treating each fragment as a complete line.

The [coroutines and flows guide](../../guides/coroutines/) explains how the bridge
retains subscription gap accounting. Use the
[capture-pane program](../../examples/capture-pane-output/) when rendered screen
state is the desired result, and the
[captured-state concepts](../../concepts/server-session-window-pane/) for local
traversal after acquisition.
