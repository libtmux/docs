---
supportedPorts: [py, ts, rs, go, java, dotnet, cxx, swift]
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

<a id="filling-in-the-rest-of-the-cardinality-table"></a>

## Require exactly one match

<!-- port:go,rs,cxx -->
| Port | Collection filter | Exactly-one | Empty | Several |
|------|--------------------|--------------|-------|---------|
<!-- port:go -->| Go | `tmuxq.Where(values, predicate)` | `tmuxq.ExactlyOne(values, predicate)` | `tmuxq.ErrNoMatch` | `tmuxq.ErrMultipleMatches` |
<!-- /port --><!-- port:rs -->| Rust | `.iter().matching(&expr)` | `.exactly_one()` | prints via the error's `Display` | same, one error type covers both |
<!-- /port --><!-- port:cxx -->| C++ | pipe a range into [`libtmux::matching(expr)`](/cxx/latest/reference/libtmux-matching/) | `libtmux::exactly_one(range)` | `.error()` says which way it went wrong | same call, same error type |
<!-- /port -->
<!-- /port -->

<!-- port:go -->
`tmuxq.ExactlyOne` returns `ErrNoMatch` for no matches and
`ErrMultipleMatches` for an ambiguous result. Keep the error when wrapping it:

```go
pane, err := tmuxq.ExactlyOne(snapshot.Panes(), func(pane *tmux.Pane) bool {
    name, present := pane.CurrentCommand()
    return present && name == "nvim"
})
if err != nil {
    return fmt.Errorf("find one editor pane: %w", err)
}
fmt.Println("editor pane:", pane.ID())
```
<!-- /port -->

<!-- port:rs -->
Rust's is `examples/find.rs`, run via `cargo run --example find`:

```rust
match panes.iter().matching(&running).exactly_one() {
    Ok(pane) => println!("exactly one: {}", pane.id()),
    Err(error) => println!("not exactly one: {error}"),
}
```
<!-- /port -->

<!-- port:cxx -->
C++'s is quoted straight from `examples/05-readme.cpp`'s `cardinality`
region into `README.md`, and `tools/docs/check_readme.py` fails the build
if the two ever disagree:

```cpp
auto addressed = *panes | libtmux::matching(libtmux::pane::id == panes->at(0).id());
if (const auto one = libtmux::exactly_one(addressed); one.has_value()) {
    std::printf("exactly one: %s\n", std::string{one->get().id()}.c_str());
}
```
<!-- /port -->

<!-- port:dotnet -->
`IEnumerable<T>.Matching<T>(expression)` returns all matching objects.
Choose an exactly-one operation only when an absent or ambiguous target should
stop the task.
<!-- /port -->
<!-- port:swift -->
`hasSession(_:)` checks existence. It does not select a single matching object.
See [Attaching to tmux](../attaching-to-tmux/).
<!-- /port -->
<!-- port:py,ts,java -->
[Filtering and queries](/concepts/queries/) describes the exactly-one method
and its missing- or multiple-match errors.
<!-- /port -->

<!-- port:dotnet,swift -->
<a id="declarative-filters-that-travel-beyond-python-and-typescript"></a>

## Declarative filters

A query document can be stored in configuration and evaluated against captured
objects. It does not contain an arbitrary callback.

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
<!-- /port -->

<!-- port:py,ts,go,swift -->
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

<!-- port:go -->
Use a predicate with `strings.EqualFold` for case-insensitive equality:

```go
matches := tmuxq.Where(snapshot.Sessions(), func(session *tmux.Session) bool {
    name, present := session.Name()
    return present && strings.EqualFold(name, "api")
})
fmt.Println("matching sessions:", len(matches))
```
<!-- /port -->

<!-- /port -->

## Push the filter into tmux, or read once and filter locally

Use a tmux-side filter to reduce the rows returned, or query a snapshot when you
need several answers from one read. [Filtering and queries](/concepts/queries/)
explains that choice. Unknown format tokens expand to empty values, so
validate an unexpectedly empty search before concluding that no objects match.

## Where to go next

- [Attach and send keys](/examples/attach-and-send-keys/): its
  "Finding an existing session instead" section is this guide's recipes
  applied to one concrete lookup.
- [Testing with libtmux](../testing-with-libtmux/): most of the fixtures
  there hand you a server with exactly one thing on it, which is precisely
  when an exactly-one query is the right tool instead of a filter you then
  index into.
