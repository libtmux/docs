---
port: ts
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

`TmuxCommandError` reports a command tmux rejected. `TmuxTransportError`
reports a failure to obtain a reply. Catch these error types separately
when the distinction affects recovery.

Distinguish a command rejected by tmux from a transport failure:

```typescript
import { TmuxCommandError, TmuxTransportError } from "libtmux";

try {
  await pane.capture();
} catch (error) {
  if (error instanceof TmuxCommandError) {
    error.args;     // the argument vector
    error.exitCode;
    error.stderr;    // tmux's own lines
  } else if (error instanceof TmuxTransportError) {
    error.kind;      // "cancelled" | "pipe" | "protocol" | "spawn" | "timeout"
    error.delivery;  // see below: this is the question a retry depends on
  }
}
```

## Is it safe to retry?

Retry a mutation automatically only when you know it was not dispatched, or when
repeating it is safe for your operation. A timeout, cancellation, or dropped
connection can occur after tmux has acted. These APIs expose delivery
information:

`TmuxTransportError.delivery` distinguishes `not_started`,
`written`, `replied`, and `indeterminate`. Only `not_started` establishes
that retrying cannot repeat an already-dispatched command.

```typescript
import { TmuxTransportError } from "libtmux";

try {
  await session.newWindow({ name: "build" });
} catch (error) {
  if (error instanceof TmuxTransportError && error.delivery === "not_started") {
    // safe to retry: nothing reached tmux
  }
}
```

Treat unknown delivery as potentially executed.

A `not_started` result means the request did not reach tmux. A `written` result
means the transport accepted the request but no terminal reply arrived.

For subprocess calls that complete normally, inspect the exit status. If a call
is interrupted or times out without a delivery state, check tmux's resulting
state before repeating a mutation.
