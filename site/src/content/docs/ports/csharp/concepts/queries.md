---
port: csharp
route: concepts/queries
title: Filtering and queries
description: How you get from every session on the server to the one pane you mean, and what happens when zero or several match.
sidebar:
  label: Filtering and queries
  group: Concepts
  order: 4
tableOfContents: true
---

Use a collection filter to find matching sessions, windows, or panes. Use an
exactly-one lookup when your next operation requires a single target.

- **Filtering returns a collection; exactly-one lookup checks the result
  count.** A filter returns zero or more matches. An exactly-one operation
  returns one object or reports a missing or ambiguous match.

- **Choose where to filter.** Filter a snapshot in your program when you need
  several queries over the same data. A tmux format filter can reduce the rows
  returned by a live read. The cost depends on the data and queries you need.

<a id="go-rust-java-c-typed-fields-that-fail-queries-at-compile-time"></a>

## Typed and local filters

Typed field operations let the compiler reject incompatible comparisons:

Examples of typed and local filters:

```csharp
IReadOnlyList<Window> windows = await session.GetWindowsAsync(ct);
IEnumerable<Window> building = windows.Where(
    each => each.Name.StartsWith("build", StringComparison.Ordinal));

// A declarative query is a document, not just a lambda run in place.
IReadOnlyList<Session> sessions = await server.GetSessionsAsync(ct);
IReadOnlyList<Session> matched = sessions.Matching<Session>(
    session => session.Name.StartsWith("build", StringComparison.Ordinal));
```

<a id="the-cardinality-contract-side-by-side"></a>

## Result counts

[Filtering and querying](/guides/querying-and-filtering/) shows exactly-one
lookups and their error handling. Do not index the first result until the
operation has established that a match exists.
