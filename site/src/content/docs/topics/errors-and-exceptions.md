---
title: Errors and exceptions
description: What a failed tmux command becomes in each port, and the question every one of them has to answer before letting you retry it.
sidebar:
  label: Errors and exceptions
  group: Topics
  order: 11
tableOfContents: true
---

A command can fail because tmux rejects it, or because the transport stops
before returning a reply. Ports report these failures through typed exceptions
or return values. Before retrying a mutation, determine whether tmux may already
have received it.

For lookup failures caused by zero or multiple matches, see [Filtering and
queries](/concepts/queries/#the-cardinality-contract-side-by-side).

## A failed command, as a value

| Port | How it fails | Base type |
|------|--------------|-----------|
| Python | throws | `LibTmuxException`: carries an optional `subcommand`; `str()` reads `"<subcommand>: <stderr>"` |
| TypeScript | throws | `LibTmuxException extends Error`, with `TmuxCommandError` (tmux ran and refused) and `TmuxTransportError` (it didn't get an answer) as the two shapes that matter here |
| Go | returns `(T, error)` | no shared base type: small typed `...Error` structs plus sentinel `errors.New` values, composed with `errors.Is` / `errors.As` and `%w` wrapping |
| Rust | returns `Result<T, Error>` | one `Error` enum, `#[non_exhaustive]`, matched rather than caught |
| Java | throws (unchecked) | `LibTmuxException extends RuntimeException` |
| .NET | throws | `LibTmuxException`, with typed subclasses per failure (`TmuxCommandException`, `TmuxTransportException`, `TmuxObjectNotFoundException`, and a dozen more) |
| C++ | returns `expected<T, CommandFailure>` | `CommandFailure { kind, delivery, exit_code, diagnostic }`: no exception type at all |
| Swift | throws (typed) | `enum TmuxError: Error`, thrown as `throws(TmuxError)`: Swift's typed-throws syntax, not a bare `throws` |

Rust and C++ return result values. Go returns an `error` that callers inspect
with `errors.Is` or `errors.As`. Exception-based ports report failures through
their exception hierarchies.

TypeScript's own docs make the split between its two exception shapes
concrete:

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

| Port | Name | States |
|------|------|--------|
| TypeScript | `TmuxTransportError.delivery` | `"not_started"` / `"written"` / `"replied"` / `"indeterminate"`: only `not_started` is safe to retry blindly |
| .NET | `LibTmuxException.Dispatch` (`TmuxDispatchState`) | `NotDispatched` / `Dispatched` / `Unknown` (the default) |
| Java | `DispatchOutcome`, via `TmuxTimeoutException.outcome()` | `NOT_DISPATCHED` / `COMPLETE` / `UNKNOWN` |
| C++ | `DeliveryStatus` | `not_started` / `written` / `replied` / `indeterminate` |
| Rust | `ControlModeErrorKind` (behind the `control-mode` feature) | `DispatchTimedOut` (safe to retry) vs. plain `TimedOut` (not: the connection may have already committed the command) |
| Python, Go's one-shot path | - | inspect the exit status after normal completion; an interrupted call needs separate state verification |
| Go's control-mode pool | handled internally, not exposed | a failed pooled connection is retired rather than reused, rather than handing the caller a retry-safety flag to check |
| Swift | documented, not typed | `ControlSession`'s own doc comment states the same rule in prose ("a command that never reached tmux is safe to retry") without a dedicated enum |

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

```csharp
try
{
    await session.CreateWindowAsync(new NewWindowRequest(name: "build"));
}
catch (LibTmuxException error) when (error.Dispatch == TmuxDispatchState.NotDispatched)
{
    // safe to retry
}
```

```cpp
auto result = session.new_window({.name = "build"});
if (!result.has_value() && result.error().delivery == libtmux::DeliveryStatus::not_started) {
  // safe to retry
}
```

A state such as `not_started`, `NotDispatched`, `NOT_DISPATCHED`, or
`DispatchTimedOut` identifies a request that did not reach tmux. Treat unknown
delivery as potentially executed. C++ and TypeScript also distinguish `written`,
where the transport accepted the request but no terminal reply has arrived.

For subprocess calls that complete normally, inspect the exit status. If a call
is interrupted or times out without a delivery state, check tmux's resulting
state before repeating a mutation.
