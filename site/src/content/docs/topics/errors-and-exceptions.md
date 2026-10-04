---
supportedPorts: [py, ts, rs, go, java, csharp, cxx, swift]
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

<!-- port:py -->
<!-- port:root -->
### Python
<!-- /port -->
Command failures raise `LibTmuxException`. It can carry a
`subcommand`; its string representation includes the subcommand and stderr.
<!-- /port -->

<!-- port:ts -->
<!-- port:root -->
### TypeScript
<!-- /port -->
`TmuxCommandError` reports a command tmux rejected. `TmuxTransportError`
reports a failure to obtain a reply. Catch these error types separately
when the distinction affects recovery.
<!-- /port -->

<!-- port:go -->
<!-- port:root -->
### Go
<!-- /port -->
Operations return an error alongside their result. Inspect typed
errors and sentinel values with `errors.As` and `errors.Is`; preserve them
when wrapping with `%w`.
<!-- /port -->

<!-- port:rs -->
<!-- port:root -->
### Rust
<!-- /port -->
Fallible operations return `Result<T, Error>`. Match the
non-exhaustive `Error` enum and include a fallback for variants added later.
<!-- /port -->

<!-- port:java -->
<!-- port:root -->
### Java
<!-- /port -->
Command failures raise unchecked exceptions derived from
`LibTmuxException`, which extends `RuntimeException`.
<!-- /port -->

<!-- port:csharp -->
<!-- port:root -->
### C#
<!-- /port -->
Failures raise subclasses of `LibTmuxException`, including
`TmuxCommandException`, `TmuxTransportException`, and
`TmuxObjectNotFoundException`.
<!-- /port -->

<!-- port:cxx -->
<!-- port:root -->
### C++
<!-- /port -->
Fallible operations return `expected<T, CommandFailure>`.
`CommandFailure` records the failure kind, delivery status, exit code, and
diagnostic.
<!-- /port -->

<!-- port:swift -->
<!-- port:root -->
### Swift
<!-- /port -->
Fallible operations use typed throws with `TmuxError`. Catch
that error to inspect the failure.
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

<!-- port:ts -->
<!-- port:root -->
### TypeScript
<!-- /port -->
`TmuxTransportError.delivery` distinguishes `not_started`,
`written`, `replied`, and `indeterminate`. Only `not_started` establishes
that retrying cannot repeat an already-dispatched command.
<!-- /port -->

<!-- port:csharp -->
<!-- port:root -->
### C#
<!-- /port -->
`LibTmuxException.Dispatch` reports a `TmuxDispatchState`:
`NotDispatched`, `Dispatched`, or `Unknown`. Treat the default, `Unknown`,
as potentially dispatched.
<!-- /port -->

<!-- port:java -->
<!-- port:root -->
### Java
<!-- /port -->
`TmuxTimeoutException.outcome()` exposes a `DispatchOutcome`:
`NOT_DISPATCHED`, `COMPLETE`, or `UNKNOWN`.
<!-- /port -->

<!-- port:cxx -->
<!-- port:root -->
### C++
<!-- /port -->
`DeliveryStatus` distinguishes `not_started`, `written`, `replied`,
and `indeterminate`.
<!-- /port -->

<!-- port:rs -->
<!-- port:root -->
### Rust
<!-- /port -->
With the `control-mode` feature, `ControlModeErrorKind.DispatchTimedOut`
means the command was not dispatched. A plain timeout can occur after tmux
received the command, so do not infer that retrying is safe.
<!-- /port -->

<!-- port:py -->
<!-- port:root -->
### Python
<!-- /port -->
Inspect the exit status after a subprocess completes. If the call was
interrupted, verify the resulting tmux state before repeating a mutation.
<!-- /port -->

<!-- port:go -->
<!-- port:root -->
### Go
<!-- /port -->
Inspect the exit status after a subprocess completes. If the call was
interrupted, verify the resulting tmux state before repeating a mutation.
A failed pooled control connection is retired, but its failure does not
prove that a mutation was never dispatched.
<!-- /port -->

<!-- port:swift -->
<!-- port:root -->
### Swift
<!-- /port -->
A control-session failure does not establish that tmux never received
the command. Retry only when non-delivery is known or repeating the
operation is safe.
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
catch (LibTmuxException error)
    when (error.Dispatch == TmuxDispatchState.NotDispatched)
{
    // safe to retry
}
```

```cpp
auto result = session.new_window({.name = "build"});
constexpr auto retryable = libtmux::DeliveryStatus::not_started;
if (!result.has_value() && result.error().delivery == retryable) {
  // safe to retry
}
```

Treat unknown delivery as potentially executed.

<!-- port:cxx,ts -->
A `not_started` result means the request did not reach tmux. A `written` result
means the transport accepted the request but no terminal reply arrived.
<!-- /port -->
<!-- port:csharp -->
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
