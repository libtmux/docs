---
port: py
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

<a id="python-filter-and-get-django-style"></a>

## Filter collections and select one object

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

<a id="the-cardinality-contract-side-by-side"></a>

## Result counts

Use `QueryList.filter` to keep matching objects and `QueryList.get` when
exactly one must match. An empty result raises `ObjectDoesNotExist` unless
you supply `default=`. Several matches raise `MultipleObjectsReturned`.

[Filtering and querying](/guides/querying-and-filtering/) shows exactly-one
lookups and their error handling. Do not index the first result until the
operation has established that a match exists.
