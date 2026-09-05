---
title: Filtering and queries
description: How you get from every session on the server to the one pane you mean, and what happens when zero or several match.
sidebar:
  label: Filtering and queries
  group: Concepts
  order: 4
tableOfContents: true
---

"Which pane is running the tests?" is the question every port's query layer
exists to answer, and they answer it with strikingly similar shapes even
though the syntax varies a lot. Two ideas recur everywhere:

- **Filtering returns a collection; getting one insists on exactly one.** A
  `.filter()` (or `.where()`) call always gives you back zero or more
  matches. A `.get()` (or `.one()`, `Selections.exactlyOne()`) call is a
  different promise: it hands you the single object itself, and raises a
  distinct, specific error when reality doesn't match that promise — one
  error for "found nothing," a different one for "found more than one." No
  port's `get()`-shaped method silently returns "the first match" the way a
  hand-rolled `results[0]` would.
- **Where the filter runs is a real choice, not an implementation detail.**
  Every port that reads a live server can filter in its own language *after*
  reading everything, or push the filter down into tmux's own format
  expressions so tmux returns only the matching rows. Which one is faster
  depends on how much data you're throwing away.

## Python: `.filter()` and `.get()`, Django-style

Every collection libtmux hands you — `server.sessions`, `session.windows`,
`window.panes` — is a `QueryList`, and you narrow it by calling `.filter()`
with keyword arguments, optionally suffixed with a lookup:

```python
>>> session.windows.filter(window_name__startswith='api')
[Window(@... ...:api-server, Session($... ...))]

>>> session.windows.filter(window_name__iregex=r'n?vim')
```

`exact`, `contains`, `startswith`, `endswith`, `regex`, and their
case-insensitive `i`-prefixed twins are all available, and conditions chain
with AND either by passing several keywords to one call or by chaining
`.filter().filter()`. `.get()` insists on exactly one result, taking a
`default` for "give me a fallback instead of raising when nothing matches" —
but a `default` only stands in for *absence*; an ambiguous match
(`MultipleObjectsReturned`) still raises even with one supplied, because
handing back an arbitrary match from several is how a script ends up driving
the wrong pane.

Server-wide collections (`server.windows`, `server.panes`) additionally
enumerate `winlink`s rather than windows — a window shared across two
sessions (via `link-window`, or a tmuxp-style grouped session) appears once
per session that links it, so a point lookup against a server-wide
collection can be genuinely, correctly ambiguous. `Window.linked_sessions`
answers "which sessions hold this" directly when that's what you actually
want. For known IDs, `Pane.from_pane_id()` / `Window.from_window_id()` ask
tmux to resolve the ID itself — tmux can't return more than one match for an
ID, so they're the right tool when `.get()` would be overkill.

For servers with hundreds or thousands of panes, `.filter()` still builds
every object before you discard the ones that don't match. `search_sessions`,
`search_windows`, and `search_panes` push a tmux `-f` filter expression down
to the server instead, so libtmux builds objects only for the matches:

```python
>>> server.search_sessions(filter='#{==:#{session_name},alpha-1}')
```

The trade-off: Python-side lookups (`__regex`, `in`, set membership) work
everywhere and need no tmux version beyond the library's own floor; tmux's
own filter grammar needs tmux ≥ 3.2, and a malformed expression fails
*silently* — an unknown format token expands to empty, which the filter
engine reads as false, so a bad filter and a filter that matched nothing
look identical. If a `search_*()` call unexpectedly returns empty, swap in
`#{m:*,#{session_name}}` first to confirm the issue is syntax, not data.

## TypeScript: criteria as data

TypeScript's `Selection.where()` takes structured, serializable criteria
rather than a predicate function — the query is data you could write to a
config file or send over MCP, not code:

```ts
snapshot.sessions.where({
  AND: [
    { name: { startsWith: "prod" } },
    { windows: { some: { name: { regex: { pattern: "^log", flags: "" } } } } },
  ],
});
```

`some` / `every` / `none` quantify over a relation the same way SQL's
`EXISTS` does, and `{ mode: "insensitive" }` opts into case-insensitivity
per comparison rather than via a separate lookup name. `.filter()` exists
alongside `.where()` for an ordinary predicate function, and the two are
deliberately never overloaded into each other — one is a value you can
encode and decode (`encodeWhereDocument` / `decodeWhereDocument`), the other
is arbitrary code. `.one()` throws `NoMatchError` / `MultipleMatchesError`;
`.oneOrUndefined()` is the `default`-shaped escape hatch.

## Go, Rust, Java, C++: typed fields that fail queries at compile time

Four of the ports lean on their type systems to make an impossible
comparison a compile error rather than a runtime empty result:

- **Go** offers both `tmux.PaneFilter{Active: tmux.Ptr(true), ...}` structs
  that push down into `SearchPanes` (one tmux command, only matches
  returned), and a `snapshot()` read followed by `tmuxq.Where(panes,
  predicate)` when you want several answers from one read.
- **Rust**'s typed field handles reject nonsense at the type level —
  `fields.pane_active.eq(true)` compiles because the field is a flag, but
  the equivalent `.gt(...)` on it would not. Expressions compose with
  `.and()`, and with the `serde` feature a query lowers to a versioned JSON
  envelope so it can travel through a config file or an MCP call.
- **Java** exposes each field as a typed accessor (`Pane_.index()`,
  `Session_.name()`) that plugs straight into an ordinary `Stream.filter()`;
  `Pane_.index().startsWith("2")` doesn't compile because the index is a
  number, not a string. `Selections.exactlyOne(...)` is the `.get()`-shaped
  call, throwing `NoMatchException` or `MultipleMatchesException`.
- **C++**'s `FilterExpr` composes with `&&`, `||`, and `!` over tmux's own
  fields (`pane::command.starts_with("nv") && pane::active`), and
  `pane::active.starts_with("x")` is a build failure, not a query that
  silently returns nothing — a property the port's own test suite asserts by
  compiling code that should *not* compile.

The same shape, port by port:

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
// would not compile — a flag has no string operations.
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

// Or build a filter that travels — stored, sent, replayed elsewhere:
let expression = try FilterExpr<Pane>.where(\.currentCommand, .isIn(["nvim", "vim"]))
let matching = try await server.panes().filter(expression)
```

## The cardinality contract, side by side

| Port | Collection filter | Exactly-one | Empty | Several |
|------|--------------------|--------------|-------|---------|
| Python | `.filter()` | `.get()` | `ObjectDoesNotExist` (or `default=`) | `MultipleObjectsReturned` |
| TypeScript | `.where()` / `.filter()` | `.one()` | `NoMatchError` (or `.oneOrUndefined()`) | `MultipleMatchesError` |
| Java | `Stream.filter()` | `Selections.exactlyOne()` | `NoMatchException` | `MultipleMatchesException` |

Go, Rust, C++, C#, and Swift each have some form of "find the one match" too,
but this page only lists the exact exception/result names verified above —
check the port's own reference for the rest rather than assuming the pattern
carries the same identifier.
