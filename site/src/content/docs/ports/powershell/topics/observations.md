---
port: "powershell"
route: "topics/observations"
title: "Watching output and state"
description: "Choose a screen capture or event stream and handle bounded delivery explicitly."
sidebar: {"label": "Watching output and state", "group": "Topics", "order": 4}
tableOfContents: true
---

A capture reads the pane's rendered screen. `Watch-TmuxEvent` observes future
notifications and output fragments. Choose the observation that matches your
question; an event stream is not a durable or byte-exact terminal log.

## Start observation before the producer

Connect the control client before triggering the change you need to observe.
One connection has one event consumer. Competing watchers are rejected, and
callers must also avoid enumerating the same native event stream independently.

One application write can span several events; one event can contain multiple
lines. Matching a marker needs state across fragments. For service readiness,
prefer the task-specific `Wait-TmuxPaneText` contract and still check that the
service responds, as the [HTTP example](../../examples/wait-for-service/) does.

## Bound both time and retained output

A foreground watcher occupies its pipeline. Use a thread job when the prompt
must remain available, and give it an event limit, text-byte budget, and deadline.
Job output can accumulate even if nobody receives it.

Limits apply per input owner. Piping several owners can multiply the total
retained output. The watcher and native transport have separate buffers, and
text-byte limits do not include every object or serialization cost. Raising
concurrency therefore needs a separate memory decision.

## Treat loss as a state change

The upstream queue is bounded. A `TmuxEventsDroppedEvent` reports discarded
records so a slow observer does not block command replies. If current topology
matters after loss, acquire a new snapshot. A fresh snapshot can restore your
view of current state; it cannot recover terminal output that was dropped.

Consumer termination can leave a record consumed before it reaches the pipeline.
Do not infer an exact delivery count solely from how many records a downstream
command prints.

## Keep the right owner alive

A watcher supplied with a connection borrows it. A watcher supplied with a server
and raw target owns its temporary client and disposes that client when it ends.
The daemon and sessions remain running in either case. Stop and remove jobs in
cleanup, and close explicitly created control clients after their observers end.

The [watch guide](../../guides/watch/) includes an owned rename observation,
background-job limits, and independent-runspace examples. Use the
[capture guide](../../guides/capture/) when the question concerns visible screen
state instead of future events.
