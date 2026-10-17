---
port: go
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

Operations return an error alongside their result. Inspect typed
errors and sentinel values with `errors.As` and `errors.Is`; preserve them
when wrapping with `%w`.

Use `errors.Is` for sentinel errors such as `tmux.ErrNoServer` and
`tmux.ErrNotFound`. Use `errors.As` to inspect a `*tmux.CommandError` and its
completed command result. Wrap errors with `%w` to preserve that information.

## Is it safe to retry?

Retry a mutation automatically only when you know it was not dispatched, or when
repeating it is safe for your operation. A timeout, cancellation, or dropped
connection can occur after tmux has acted. These APIs expose delivery
information:

Inspect the exit status after a subprocess completes. If the call was
interrupted, verify the resulting tmux state before repeating a mutation.
A failed pooled control connection is retired, but its failure does not
prove that a mutation was never dispatched.

Treat unknown delivery as potentially executed.

For subprocess calls that complete normally, inspect the exit status. If a call
is interrupted or times out without a delivery state, check tmux's resulting
state before repeating a mutation.
