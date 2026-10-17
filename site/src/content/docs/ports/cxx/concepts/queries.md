---
port: cxx
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

Compose `FilterExpr` values with `&&`, `||`, and `!`. For example,
`pane::command.starts_with("nv") && pane::active` is valid, while
`pane::active.starts_with("x")` fails to compile.

Examples of typed and local filters:

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

<a id="the-cardinality-contract-side-by-side"></a>

## Result counts

[Filtering and querying](/guides/querying-and-filtering/) shows exactly-one
lookups and their error handling. Do not index the first result until the
operation has established that a match exists.
