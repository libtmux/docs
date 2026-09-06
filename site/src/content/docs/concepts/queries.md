---
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
  count.** A `.filter()` or `.where()` call returns zero or more matches. Methods
  such as `.get()`, `.one()`, and `Selections.exactlyOne()` return one object or
  report a missing or ambiguous match.

- **Choose where to filter.** Filter a snapshot in your program when you need
  several queries over the same data. A tmux format filter can reduce the rows
  returned by a live read. The cost depends on the data and queries you need.

## Python: `.filter()` and `.get()`, Django-style

`server.sessions`, `session.windows`, and `window.panes` are `QueryList`
collections. Call `.filter()` with field names and optional lookup suffixes:

```python
>>> session.windows.filter(window_name__startswith='api')
[Window(@... ...:api-server, Session($... ...))]

>>> session.windows.filter(window_name__iregex=r'n?vim')
```

Lookups include `exact`, `contains`, `startswith`, `endswith`, `regex`, and
their case-insensitive `i`-prefixed variants. Multiple keywords and chained
`.filter()` calls combine with AND. `.get()` requires exactly one match. Its
`default` argument handles an absent result; multiple matches still raise
`MultipleObjectsReturned`.

Server-wide collections (`server.windows`, `server.panes`) enumerate window
links. A window linked to two sessions appears once per session, so a lookup can
be ambiguous even when the window ID is unique. Use `Window.linked_sessions` to
find its sessions. For a known ID, use `Pane.from_pane_id()` or
`Window.from_window_id()` to resolve the object directly.

For servers with hundreds or thousands of panes, `.filter()` still builds
every object before you discard the ones that don't match. `search_sessions`,
`search_windows`, and `search_panes` push a tmux `-f` filter expression down
to the server instead, so libtmux builds objects only for the matches:

```python
>>> server.search_sessions(filter='#{==:#{session_name},alpha-1}')
```

Python-side lookups work with the library's supported tmux versions. The tmux
filter grammar requires tmux 3.2 or newer. An unknown format token expands to an
empty value, so a malformed filter can look like a valid filter with no matches.
If `search_*()` unexpectedly returns no results, try `#{m:*,#{session_name}}` to
check that the session data is available.

## TypeScript: criteria as data

TypeScript's `Selection.where()` accepts structured, serializable criteria that
can be stored in a configuration file or sent through MCP:

```ts
snapshot.sessions.where({
  AND: [
    { name: { startsWith: "prod" } },
    { windows: { some: { name: { regex: { pattern: "^log", flags: "" } } } } },
  ],
});
```

`some`, `every`, and `none` test related objects. `{ mode: "insensitive" }`
enables case-insensitive comparison. Use `.where()` for criteria that can be
encoded with `encodeWhereDocument` and decoded with `decodeWhereDocument`; use
`.filter()` for a predicate function. `.one()` throws `NoMatchError` or
`MultipleMatchesError`. `.oneOrUndefined()` permits an absent result.

## Go, Rust, Java, C++: typed fields that fail queries at compile time

These ports use typed fields to reject invalid comparisons at compile time:

- **Go** offers both `tmux.PaneFilter{Active: tmux.Ptr(true), ...}` structs
  that push down into `SearchPanes` (one tmux command, only matches
  returned), and a `snapshot()` read followed by `tmuxq.Where(panes,
  predicate)` when you want several answers from one read.
- **Rust** uses typed fields: `fields.pane_active.eq(true)` is valid, but
  `.gt(...)` on that boolean field is not. Expressions compose with `.and()`.
  With the `serde` feature, a query can be encoded as a versioned JSON document
  for configuration or MCP.
- **Java** exposes each field as a typed accessor (`Pane_.index()`,
  `Session_.name()`) that plugs straight into an ordinary `Stream.filter()`;
  `Pane_.index().startsWith("2")` doesn't compile because the index is a
  number, not a string. `Selections.exactlyOne(...)` is the `.get()`-shaped
  call, throwing `NoMatchException` or `MultipleMatchesException`.
- **C++** composes `FilterExpr` values with `&&`, `||`, and `!`, as in
  `pane::command.starts_with("nv") && pane::active`. Invalid field operations
  such as `pane::active.starts_with("x")` fail to compile.

Examples of typed and local filters:

```rust
use libtmux::query::{Filterable as _, QueryIteratorExt as _};

let fields = libtmux::Pane::filter_fields();

// `pane_active` is a flag, so `.eq(true)` compiles; `.gt(..)` would not.
let active = fields
    .pane_current_command
    .starts_with("sh")
    .and(fields.pane_active.eq(true));

let panes = server.panes().await?;
let matched: Vec<_> = panes.iter().matching(&active).collect();
```

```go
// Read once, filter in Go: several answers from one read.
snapshot, err := server.Snapshot(ctx)
if err != nil {
	return err
}
predicate, err := tmux.PaneActiveIs(true).Predicate()
if err != nil {
	return err
}
active := tmuxq.Where(snapshot.Panes(), predicate)
fmt.Println("active panes:", len(active))

// Or push the filter down: tmux returns only the matches.
filter := tmux.PaneFilter{Active: tmux.Ptr(true)}
panes, err := server.SearchPanes(ctx, &filter)
if err != nil {
	return err
}
fmt.Println("live matches:", len(panes))
```

```java
List<Window> editors = server.windows().stream()
        .filter(Window_.name().startsWith("edit"))
        .toList();

// Selections.exactlyOne() is the `.get()`-shaped call.
Session build = Selections.exactlyOne(
        server.sessions().stream().filter(Session_.name().is("build")).toList());
```

```csharp
IReadOnlyList<Window> windows = await session.GetWindowsAsync(ct);
IEnumerable<Window> building = windows.Where(
    each => each.Name.StartsWith("build", StringComparison.Ordinal));

// A declarative query is a document, not just a lambda run in place.
IReadOnlyList<Session> sessions = await server.GetSessionsAsync(ct);
IReadOnlyList<Session> matched = sessions.Matching<Session>(
    session => session.Name.StartsWith("build", StringComparison.Ordinal));
```

```cpp
// A filter is a value built from typed fields; `window::active.starts_with(...)`
// would not compile: a flag has no string operations.
const auto interesting =
    libtmux::window::name.starts_with("e") || libtmux::window::name == "logs";

auto matched = *windows | libtmux::matching(interesting);

// "Exactly one, or say why not" is a question the library answers directly.
auto logs = *windows | libtmux::matching(libtmux::window::name == "logs");
if (const auto only = libtmux::exactly_one(logs); only.has_value()) {
  std::printf("exactly one: %s\n", std::string{only->get().id()}.c_str());
}
```

```swift
// Filter locally with the standard library:
let editors = try await server.panes().filter { $0.currentCommand == "nvim" }

// Or build a filter that travels: stored, sent, replayed elsewhere:
let expression = try FilterExpr<Pane>.where(\.currentCommand, .isIn(["nvim", "vim"]))
let matching = try await server.panes().filter(expression)
```

## The cardinality contract, side by side

| Port | Collection filter | Exactly-one | Empty | Several |
|------|--------------------|--------------|-------|---------|
| Python | `.filter()` | `.get()` | `ObjectDoesNotExist` (or `default=`) | `MultipleObjectsReturned` |
| TypeScript | `.where()` / `.filter()` | `.one()` | `NoMatchError` (or `.oneOrUndefined()`) | `MultipleMatchesError` |
| Java | `Stream.filter()` | `Selections.exactlyOne()` | `NoMatchException` | `MultipleMatchesException` |

See the Go, Rust, C++, .NET, and Swift references for their exactly-one result
types and failure handling.
