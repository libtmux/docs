---
port: "fsharp"
route: "topics/observations"
title: "Streams and live state"
description: "Choose a single-result wait, a destructive event stream, or a reconciled mirror."
sidebar: {"label": "Streams and live state", "group": "Topics", "order": 4}
tableOfContents: true
---

A captured snapshot is a replayable local observation. A control client's event
stream is ordered, live, and destructive: reading an event consumes it. Do not
use it as though it were an ordinary replayable sequence.

## Choose the observation contract

| Need | Use |
| --- | --- |
| One shell completion or text condition | The appropriate `Pane.run`, `Pane.sendAndWait`, `Pane.waitForText`, or `Pane.waitUntil` operation. |
| React to individual notifications | `Control.events`. |
| Output from one or several panes | `Control.watchPane` or `Control.watchPanes`. |
| A maintained captured view of topology | `Mirror.start`, or `Mirror.startRefreshing` for periodic refresh during quiet intervals. |

A wait returns one result. A stream transfers responsibility for matching, loss,
termination, and cleanup to its consumer. A mirror reacquires state; it does not
make every tmux property observable through notifications.

## One client has one event consumer

The async enumerables are cold: no records are read until enumeration starts.
The consumer supplies cancellation. `Control.foldWhile` and `Control.iter` await
one callback at a time and dispose their enumerator while leaving a borrowed
client open.

Watching two panes independently requires independent clients. Use
`Control.watchPanes` to follow several through one stream; each output identifies
its pane, and unrelated events are consumed by that watcher. Acquire the client
for the session that contains the panes.

## Gaps and terminal events matter

A bounded client can report `TmuxEventsDroppedEvent`. Its `OnlyOutput` flag
distinguishes output-only loss from lost notifications. Reacquire current state
when the notifications used to maintain it may be incomplete. A screen capture
can show the present screen, but cannot restore a complete missing output history.

A fast-exiting program can lose terminal output before tmux sends it to a control
client. Prefer the documented completion operation or capture a pane retained
with remain-on-exit when final output matters. An exit event, stream failure,
consumer cancellation, and explicit client closure are different endings.

A mirror reacts to announced changes and can refresh during quiet intervals for
state tmux does not announce. Its anchor-session lifetime remains relevant; it is
not an independent permanent service.

The [streams guide](../../guides/streams/) specifies loss, final output, mirror
refresh, and cleanup behavior. See [ownership](../ownership/) before sharing a
client, and [task cancellation](../execution/) before interpreting an interrupted
operation as having no effect.
