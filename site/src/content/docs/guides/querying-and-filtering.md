---
title: Filtering and querying, in practice
description: Filter tmux objects, require one match, and choose where a query runs.
sidebar:
  label: Querying and filtering
  group: Guides
  order: 6
tableOfContents: true
---

Find sessions, windows, or panes with collection filters and exactly-one
lookups. [Filtering and queries](/concepts/queries/) explains the result-count
contracts and the choice between local and tmux-side filtering. This guide adds
examples for common queries.

## Filling in the rest of the cardinality table

| Port | Collection filter | Exactly-one | Empty | Several |
|------|--------------------|--------------|-------|---------|
| Go | `tmuxq.Where(values, predicate)` | `tmuxq.ExactlyOne(values, predicate)` | `tmuxq.ErrNoMatch` | `tmuxq.ErrMultipleMatches` |
| Rust | `.iter().matching(&expr)` | `.exactly_one()` | prints via the error's `Display` | same, one error type covers both |
| C++ | `range \| libtmux::matching(expr)` | `libtmux::exactly_one(range)` | `.error()` says which way it went wrong | same call, same error type |

Go's `ExampleExactlyOne` in `tmuxq/example_test.go` checks the result with `go
test` and `// Output:` assertions:

```go
_, err := tmuxq.ExactlyOne(noActivePanes, func(pane *pane) bool { return pane.active })
// errors.Is(err, tmuxq.ErrNoMatch) → true

_, err = tmuxq.ExactlyOne(multipleActivePanes, func(pane *pane) bool { return pane.active })
// errors.Is(err, tmuxq.ErrMultipleMatches) → true
```

Rust's is `examples/find.rs`, run via `cargo run --example find`:

```rust
match panes.iter().matching(&running).exactly_one() {
    Ok(pane) => println!("exactly one: {}", pane.id()),
    Err(error) => println!("not exactly one: {error}"),
}
```

C++'s is quoted straight from `examples/05-readme.cpp`'s `cardinality`
region into `README.md`, and `tools/docs/check_readme.py` fails the build
if the two ever disagree:

```cpp
auto addressed = *panes | libtmux::matching(libtmux::pane::id == panes->at(0).id());
if (const auto one = libtmux::exactly_one(addressed); one.has_value()) {
    std::printf("exactly one: %s\n", std::string{one->get().id()}.c_str());
}
```

For .NET and Swift result-count handling, consult the port reference. The
examples here demonstrate .NET's `IEnumerable<T>.Matching<T>(expression)`
returning an `IReadOnlyList<Session>` and Swift's `hasSession(_:)` returning a
`Bool`. The latter checks existence; see [Attaching to
tmux](../attaching-to-tmux/#finding-a-session-instead-of-always-creating-one).

## Declarative filters that travel, beyond Python and TypeScript

[Filtering and queries](/concepts/queries/) covers Python's `.filter()`
lookups and TypeScript's `.where()` documents. Two more ports build the same
"a query is data, not code" idea, verified against their own README:

```csharp
// Turns a LINQ expression into a portable QueryDocument (or throws),
// evaluated locally over objects you already hold rather than compiled
// into tmux's own format language. Translate<T>(...) produces the document
// directly when you want the wire form without also running the filter.
// Stable wire names map Session.Name to session_name in the query document.
IReadOnlyList<Session> building = sessions.Matching<Session>(
    session => session.Name.StartsWith("build", StringComparison.Ordinal) && session.Attached);
```

```swift
// Built from key paths, so a text operator on a number is a compile error,
// and it holds no closures, so it encodes for an MCP tool call.
let expression = FilterExpr<Pane>.where(\.currentCommand, .isIn(["nvim", "vim"]))
```

Sources: .NET's is `src/LibTmux/README.md`, "Filtering." Swift's is
`Examples/Sources/ExampleCode/Filtering.swift`, matched against the README
by `Scripts/check_examples.py`.

## Case-insensitive matching

```python
# An i-prefixed lookup.
session.windows.filter(window_name__istartswith="bg")
```

```typescript
// mode: "insensitive" on the comparison, rather than a separate lookup name.
snapshot.sessions.where({ name: { contains: "API", mode: "insensitive" } });
```

```swift
// Passed to the regex pattern itself rather than to the filter.
let editors = try RegexPattern("^(n?vim|hx)$", options: [.caseInsensitive])
let expression = FilterExpr<Pane>.where(\.currentCommand, .matches(editors))
```

For case-insensitive matching in Java, .NET, Go, Rust, and C++, consult the port
reference. Sources for the examples above: Python's lookup is covered in
[Filtering and queries](../../concepts/queries/); TypeScript's is in
`README.md`, "What querying looks like"; Swift's is in
`Examples/Sources/ExampleCode/Filtering.swift`.

## Push the filter into tmux, or read once and filter locally

Use a tmux-side filter to reduce the rows returned, or query a snapshot when you
need several answers from one read. [Filtering and queries](/concepts/queries/)
compares Python's `search_sessions()` with `.filter()`, and Go's `SearchPanes`
with a snapshot plus `tmuxq.Where`. Check the required tmux version. Unknown
format tokens expand to empty values, so validate an unexpectedly empty search
before concluding that no objects match.

## Where to go next

- [Attach and send keys](/examples/attach-and-send-keys/): its
  "Finding an existing session instead" section is this guide's recipes
  applied to one concrete lookup.
- [Testing with libtmux](../testing-with-libtmux/): most of the fixtures
  there hand you a server with exactly one thing on it, which is precisely
  when an exactly-one query is the right tool instead of a filter you then
  index into.
