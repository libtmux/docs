---
supportedPorts: [py, ts, rs, go, java, dotnet, cxx, swift]
title: Errors and exceptions
description: Handle command failures, inspect delivery status, and decide when a retry is safe.
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
<!-- port:py -->| Python | throws | `LibTmuxException`: carries an optional `subcommand`; `str()` reads `"<subcommand>: <stderr>"` |
<!-- /port --><!-- port:ts -->| TypeScript | throws | `LibTmuxException extends Error`, with `TmuxCommandError` (tmux ran and refused) and `TmuxTransportError` (it didn't get an answer) as the two shapes that matter here |
<!-- /port --><!-- port:go -->| Go | returns `(T, error)` | no shared base type: small typed `...Error` structs plus sentinel `errors.New` values, composed with `errors.Is` / `errors.As` and `%w` wrapping |
<!-- /port --><!-- port:rs -->| Rust | returns `Result<T, Error>` | one `Error` enum, `#[non_exhaustive]`, matched rather than caught |
<!-- /port --><!-- port:java -->| Java | throws (unchecked) | `LibTmuxException extends RuntimeException` |
<!-- /port --><!-- port:dotnet -->| .NET | throws | `LibTmuxException`, with typed subclasses per failure (`TmuxCommandException`, `TmuxTransportException`, `TmuxObjectNotFoundException`, and a dozen more) |
<!-- /port --><!-- port:cxx -->| C++ | returns `expected<T, CommandFailure>` | `CommandFailure { kind, delivery, exit_code, diagnostic }`: no exception type at all |
<!-- /port --><!-- port:swift -->| Swift | throws (typed) | `enum TmuxError: Error`, thrown as `throws(TmuxError)`: Swift's typed-throws syntax, not a bare `throws` |
<!-- /port -->
<!-- port:go -->
Use `errors.Is` for sentinel errors such as `tmux.ErrNoServer` and
`tmux.ErrNotFound`. Use `errors.As` to inspect a `*tmux.CommandError` and its
completed command result. Wrap errors with `%w` to preserve that information.
<!-- /port -->

<!-- port:ts -->
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

<!-- /port -->

## Is it safe to retry?

Retry a mutation automatically only when you know it was not dispatched, or when
repeating it is safe for your operation. A timeout, cancellation, or dropped
connection can occur after tmux has acted. These APIs expose delivery
information:

| Port | Name | States |
|------|------|--------|
<!-- port:ts -->| TypeScript | `TmuxTransportError.delivery` | `"not_started"` / `"written"` / `"replied"` / `"indeterminate"`: only `not_started` is safe to retry blindly |
<!-- /port --><!-- port:dotnet -->| .NET | `LibTmuxException.Dispatch` (`TmuxDispatchState`) | `NotDispatched` / `Dispatched` / `Unknown` (the default) |
<!-- /port --><!-- port:java -->| Java | `DispatchOutcome`, via `TmuxTimeoutException.outcome()` | `NOT_DISPATCHED` / `COMPLETE` / `UNKNOWN` |
<!-- /port --><!-- port:cxx -->| C++ | `DeliveryStatus` | `not_started` / `written` / `replied` / `indeterminate` |
<!-- /port --><!-- port:rs -->| Rust | `ControlModeErrorKind` (behind the `control-mode` feature) | `DispatchTimedOut` (safe to retry) vs. plain `TimedOut` (not: the connection may have already committed the command) |
<!-- /port --><!-- port:py,go -->| Process calls | - | inspect the exit status after normal completion; an interrupted call needs separate state verification |
<!-- /port -->
<!-- port:go -->| Control pool | connection retirement | a failed pooled connection is retired; its failure does not prove that a mutation was never dispatched |
<!-- /port -->
<!-- port:swift -->| Swift | documented, not typed | `ControlSession`'s own doc comment states the same rule in prose ("a command that never reached tmux is safe to retry") without a dedicated enum |
<!-- /port -->
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

Treat unknown delivery as potentially executed.

<!-- port:cxx,ts -->
A `not_started` result means the request did not reach tmux. A `written` result
means the transport accepted the request but no terminal reply arrived.
<!-- /port -->
<!-- port:dotnet -->
`NotDispatched` identifies a request that did not reach tmux.
<!-- /port -->
<!-- port:java -->
`NOT_DISPATCHED` identifies a request that did not reach tmux.
<!-- /port -->
<!-- port:rs -->
`DispatchTimedOut` identifies a request that did not reach tmux.
<!-- /port -->

For subprocess calls that complete normally, inspect the exit status. If a call
is interrupted or times out without a delivery state, check tmux's resulting
state before repeating a mutation.
