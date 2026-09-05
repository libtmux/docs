---
title: Errors and exceptions
description: What a failed tmux command becomes in each port, and the question every one of them has to answer before letting you retry it.
sidebar:
  label: Errors and exceptions
  group: Topics
  order: 11
tableOfContents: true
---

A tmux command can fail two different ways: tmux runs it and refuses (a
nonzero exit, a message on stderr), or something between your process and
tmux goes wrong before an answer comes back at all — a timeout, a closed
pipe, a cancelled call. Every port turns both into something typed rather
than a bare string, but they split on *how* — thrown exceptions in some,
returned values in others — and, more interestingly, on a question that only
matters once you're thinking about retrying: did tmux actually see this
command or not?

[Filtering and queries](/concepts/queries/#the-cardinality-contract-side-by-side)
already covers the other common error shape — a lookup that matched zero or
more than one object (`ObjectDoesNotExist` / `MultipleObjectsReturned` and
their per-port names) — so it isn't repeated here.

## A failed command, as a value

| Port | How it fails | Base type |
|------|--------------|-----------|
| Python | throws | `LibTmuxException` — carries an optional `subcommand`; `str()` reads `"<subcommand>: <stderr>"` |
| TypeScript | throws | `LibTmuxException extends Error`, with `TmuxCommandError` (tmux ran and refused) and `TmuxTransportError` (it didn't get an answer) as the two shapes that matter here |
| Go | returns `(T, error)` | no shared base type — small typed `...Error` structs plus sentinel `errors.New` values, composed with `errors.Is` / `errors.As` and `%w` wrapping |
| Rust | returns `Result<T, Error>` | one `Error` enum, `#[non_exhaustive]`, matched rather than caught |
| Java | throws (unchecked) | `LibTmuxException extends RuntimeException` |
| .NET | throws | `LibTmuxException`, with typed subclasses per failure (`TmuxCommandException`, `TmuxTransportException`, `TmuxObjectNotFoundException`, and a dozen more) |
| C++ | returns `expected<T, CommandFailure>` | `CommandFailure { kind, delivery, exit_code, diagnostic }` — no exception type at all |
| Swift | throws (typed) | `enum TmuxError: Error`, thrown as `throws(TmuxError)` — Swift's typed-throws syntax, not a bare `throws` |

Rust and C++ read as the same idea in different clothes: neither throws, and
both make the caller handle failure at the call site rather than letting it
propagate silently through an unrelated `catch`. Go is the outlier even
among the two `Result`-shaped ports — no single error type to match on at
all, just many small ones and the standard library's own composition tools.

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
    error.delivery;  // see below — this is the question a retry depends on
  }
}
```

## Is it safe to retry?

Retrying a *mutation* is only safe if the first attempt never reached tmux —
otherwise a retried `kill-session` or `new-window` can repeat a side effect
that already happened. That's easy to get right for a plain one-shot
subprocess call that ran to completion: the exit code is the whole story.
It stops being easy the moment a command can be cut off mid-flight — a
timeout, a cancelled task, a dropped control-mode connection — because then
"did tmux see it" genuinely has no default answer. Five ports encode this as
an explicit, named state rather than leaving it to be inferred (or
guessed) from whichever exception happened to come back:

| Port | Name | States |
|------|------|--------|
| TypeScript | `TmuxTransportError.delivery` | `"not_started"` / `"written"` / `"replied"` / `"indeterminate"` — only `not_started` is safe to retry blindly |
| .NET | `LibTmuxException.Dispatch` (`TmuxDispatchState`) | `NotDispatched` / `Dispatched` / `Unknown` (the default) |
| Java | `DispatchOutcome`, via `TmuxTimeoutException.outcome()` | `NOT_DISPATCHED` / `COMPLETE` / `UNKNOWN` |
| C++ | `DeliveryStatus` | `not_started` / `written` / `replied` / `indeterminate` |
| Rust | `ControlModeErrorKind` (behind the `control-mode` feature) | `DispatchTimedOut` (safe to retry) vs. plain `TimedOut` (not — the connection may have already committed the command) |
| Python, Go's one-shot path | — | not needed: a plain subprocess call that returns is a call that ran; there's no in-between state to name |
| Go's control-mode pool | handled internally, not exposed | a failed pooled connection is retired rather than reused, rather than handing the caller a retry-safety flag to check |
| Swift | documented, not typed | `ControlSession`'s own doc comment states the same rule in prose ("a command that never reached tmux is safe to retry") without a dedicated enum |

```typescript
import { TmuxTransportError } from "libtmux";

try {
  await session.newWindow({ name: "build" });
} catch (error) {
  if (error instanceof TmuxTransportError && error.delivery === "not_started") {
    // safe to retry — nothing reached tmux
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

All four typed versions agree on the shape even where the vocabulary
differs: exactly one state (`not_started` / `NotDispatched` /
`NOT_DISPATCHED` / `DispatchTimedOut`) is ever safe to retry blindly, an
"unknown" state defaults toward *not* retrying rather than assuming success,
and a definite "tmux ran this" state means whatever the command does has
already happened — the failure is tmux refusing or reporting an error, not
the command going missing. C++'s and TypeScript's shared `written` state
splits the middle ground further still: the request reached the transport
but no terminal reply came back, which is closer to "assume it ran" than to
"assume it didn't."

Where a port doesn't expose this at all, it's usually because the question
doesn't arise for how that port runs commands, not because the port ignored
it: Python's and Go's default one-shot subprocess path returns only once
the process has actually exited, so there's no window in which "did it run"
is unknown by the time you have a result to inspect at all. It becomes a
live question the moment either port's own control-mode or pooled-connection
path is in use instead — Go handles that internally rather than surfacing a
retry-safety value to the caller.
