---
title: Filtering and querying, in practice
description: The exactly-one identifiers concepts/queries.md leaves for your own port's reference, plus copy-paste recipes for the questions that come up most.
sidebar:
  label: Querying and filtering
  group: Guides
  order: 6
tableOfContents: true
---

[Filtering and queries](/concepts/queries/) is the mental model: why a
"find zero or more" call and a "give me exactly one" call are different
promises, and where each port draws the line between filtering after a read
and pushing a filter down into tmux itself. Read that first if you haven't.
This page is the how-to companion — it picks up exactly where that page's
own cardinality table stops (it verified Python, TypeScript, and Java's
exact identifiers and left the rest as "check the port's own reference"),
and adds the recipes worth having on hand.

## Filling in the rest of the cardinality table

| Port | Collection filter | Exactly-one | Empty | Several |
|------|--------------------|--------------|-------|---------|
| Go | `tmuxq.Where(values, predicate)` | `tmuxq.ExactlyOne(values, predicate)` | `tmuxq.ErrNoMatch` | `tmuxq.ErrMultipleMatches` |
| Rust | `.iter().matching(&expr)` | `.exactly_one()` | prints via the error's `Display` | same, one error type covers both |
| C++ | `range \| libtmux::matching(expr)` | `libtmux::exactly_one(range)` | `.error()` says which way it went wrong | same call, same error type |

Sources: Go's `tmuxq.ExactlyOne` is exercised by `ExampleExactlyOne` in
`tmuxq/example_test.go` — a Go `Example` function with a checked
`// Output:` comment, so `go test` fails if the sentinel behavior ever
changes:

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

**.NET and Swift don't have a checked snippet for this page to quote.**
.NET's `IEnumerable<T>.Matching<T>(expression)` (see below) returns a plain
`IReadOnlyList<Session>`, and ordinary LINQ `.Single()` / `.SingleOrDefault()`
would sit on top of it the way they would any list — but no README block
demonstrates that combination as of this page, so it isn't presented as
verified. Swift's closest checked call is `hasSession(_:)`, which answers
existence as a `Bool` rather than cardinality — see
[Attaching to tmux](../attaching-to-tmux/#finding-a-session-instead-of-always-creating-one).
Check each port's own reference before relying on either gap.

## Declarative filters that travel, beyond Python and TypeScript

[Filtering and queries](/concepts/queries/) covers Python's `.filter()`
lookups and TypeScript's `.where()` documents. Two more ports build the same
"a query is data, not code" idea, verified against their own README:

```csharp
// Turns a LINQ expression into a portable QueryDocument (or throws),
// evaluated locally over objects you already hold rather than compiled
// into tmux's own format language. Translate<T>(...) produces the document
// directly when you want the wire form without also running the filter.
// Stable wire names — Session.Name becomes session_name — and a fixed
// twelve-field catalog are what make the document portable at all.
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

Java, .NET, Go, Rust, and C++: no case-insensitive comparison was found
quoted in a checked source for this page; several almost certainly expose
one (a plain lowercasing comparison, or a regex flag, works everywhere as a
fallback), but this page only lists what it verified. Sources: Python's
lookup is [Filtering and queries](../../concepts/queries/) (this site). TypeScript's is `README.md`,
"What querying looks like." Swift's is
`Examples/Sources/ExampleCode/Filtering.swift`.

## Push the filter into tmux, or read once and filter locally

This tradeoff is the subject of most of [Filtering and
queries](/concepts/queries/) — Python's
`search_sessions()` against `.filter()`, Go's `SearchPanes` against a
`snapshot()` plus `tmuxq.Where`. The short version, if you only remember
one thing: pushing down costs a stricter tmux version (≥ 3.2 for Python's
format grammar) and fails *silently* on a malformed expression rather than
erroring, because an unknown format token expands to empty. If a
push-down search unexpectedly comes back empty, confirm the issue is syntax
before assuming it's data.

## Where to go next

- [Attach and send keys](/examples/attach-and-send-keys/) — its
  "Finding an existing session instead" section is this guide's recipes
  applied to one concrete lookup.
- [Testing with libtmux](../testing-with-libtmux/) — most of the fixtures
  there hand you a server with exactly one thing on it, which is precisely
  when an exactly-one query is the right tool instead of a filter you then
  index into.
