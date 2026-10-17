---
port: cxx
route: topics/errors-and-exceptions
title: Errors and exceptions
description: Handle command failures, inspect delivery status, and decide when a retry is safe.
sidebar:
  label: Errors and exceptions
  group: Topics
  order: 11
tableOfContents: true
---

A command can fail because tmux rejects it, or because the transport stops
before returning a reply. Inspect the reported error and delivery state before
retrying a mutation: tmux may already have received it.

For lookup failures caused by zero or multiple matches, see [Filtering and
queries](/concepts/queries/#the-cardinality-contract-side-by-side).

## A failed command, as a value

Fallible operations return `expected<T, CommandFailure>`.
`CommandFailure` records the failure kind, delivery status, exit code, and
diagnostic.

## Is it safe to retry?

Retry a mutation automatically only when you know it was not dispatched, or when
repeating it is safe for your operation. A timeout, cancellation, or dropped
connection can occur after tmux has acted. These APIs expose delivery
information:

`DeliveryStatus` distinguishes `not_started`, `written`, `replied`,
and `indeterminate`.

```cpp
auto result = session.new_window({.name = "build"});
if (!result.has_value() && result.error().delivery == libtmux::DeliveryStatus::not_started) {
  // safe to retry
}
```

Treat unknown delivery as potentially executed.

A `not_started` result means the request did not reach tmux. A `written` result
means the transport accepted the request but no terminal reply arrived.

For subprocess calls that complete normally, inspect the exit status. If a call
is interrupted or times out without a delivery state, check tmux's resulting
state before repeating a mutation.
