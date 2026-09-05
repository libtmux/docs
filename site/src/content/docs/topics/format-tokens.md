---
title: Format-token fields
description: The typed fields every object exposes, mirroring tmux's own format tokens, and why a field is sometimes absent.
sidebar:
  label: Format-token fields
  group: Topics
  order: 7
tableOfContents: true
---

Every object a port hands you — server, session, window, pane, client —
carries a flat set of typed fields that report state straight from tmux,
mirroring tmux's own [FORMATS](https://man.openbsd.org/tmux.1#FORMATS)
tokens: `pane_id`, `window_zoomed_flag`, `session_name`, and roughly two
hundred more. This is why a pane object can hand you its id, its window's
id, and its session's id without you writing a raw tmux command — and why,
occasionally, one of those fields comes back empty instead of a value.

A field is gated on two things: **scope** (a `pane_*` token needs pane
context; it isn't going to appear on a `Session`) and **version** (tmux
added the token in a specific release, and a port built against an older
tmux simply never learns about it). Every port handles the *concept* the
same way; each language's own idiom for "a value that might not be there"
is where they differ.

## The absence idiom, per port

| Port | What an excluded field looks like |
|------|--------------------------------------|
| Python | the attribute is `None` |
| TypeScript | the property is `undefined` |
| Go | a two-return-value accessor: `pane.DeadSignal()` returns `(string, bool)` — Go's own "comma ok" idiom |
| Rust | `Option<T>` — verified from the `formats.rs` gating table; the public accessor's exact spelling wasn't separately checked |
| Java | `Optional<T>` — `pane.floating()` returns `Optional<Boolean>`, empty when the field isn't populated |
| .NET | a nullable property (`string?`), or `IncompleteSnapshotException` — see the note below, because .NET's gate isn't quite the same question |
| C++, Swift | doesn't apply the same way — see below: neither generated the full token catalog as struct fields in the first place |

Reading the same gated field — `pane_dead_signal`, tmux 3.3+ — in each port
that carries it as a typed accessor:

```python
pane.pane_dead_signal  # None below tmux 3.3, or on a pane that isn't dead
```

```typescript
pane.deadSignal; // undefined under the same conditions
```

```go
signal, ok := pane.DeadSignal() // ok is false when the token isn't populated
```

```java
pane.floating(); // Optional<Boolean> — a different field, same idiom: empty
                  // rather than a sentinel when the token isn't populated
```

Rust's `formats.rs` gates this token the same way, decoded as `Option<T>`;
this page hasn't separately verified the accessor's exact name, so it's left
out here rather than guessed.

.NET's case is worth pulling apart separately because it looks like the same
gate but answers a different question. `Pane.Title` is a nullable `string?`
because
tmux itself can report no title — that's the ordinary absence case, same as
everywhere else. But `Pane.Height`, `.Width`, and `.Index` throw
`IncompleteSnapshotException` instead of returning something nullable, and
the reason is specific to .NET's snapshot model: those properties read from
whatever fields the *capture that produced this handle* actually requested,
not from "does this tmux version know this token." A `Pane` resolved by ID
alone, without a full listing behind it, hasn't got the data to answer —
which is a completeness gate on the read, not a version or scope gate on
the token itself.

```csharp
string? title = pane.Title;   // nullable: the ordinary absence case
int height = pane.Height;     // throws IncompleteSnapshotException instead,
                               // if this Pane wasn't captured with a full listing
```

## A generated table under the accessor

None of the eight hand-types the ~200-entry token list as a flat set of
`if` statements. Each generates a scope- and version-tagged table from
tmux's own source or documentation and drives the typed accessors from it —
[Architecture](../architecture/) covers the generated-table pattern across
all eight in more depth; the shape that matters here is what one row looks
like:

- **TypeScript**'s `_generated/format_fields.ts` is a flat array of
  `{ scope, since, token }` rows — `{ scope: "pane", since: "3.7", token:
  "pane_zoomed_flag" }` — that a separate camelCase alias table
  (`_generated/field_aliases.ts`) maps onto the property you actually read
  (`pane.zoomedFlag`).
- **Rust**'s `formats.rs` is a macro invocation per token carrying the wire
  name, scope, tmux version, and declared type together — e.g. the row for
  `pane_dead_signal` tags it `Pane` scope, `V3_3`, decoded as `Text`.
- **Go**'s `format_generated.go` is built by a code generator
  (`internal/generate/formats`) reading tmux's own token catalog, and — the
  one place a port goes beyond string-or-bool — decodes some tokens to a
  richer type than the others: `pane.DeadTime()` returns `(time.Time,
  bool)`, not a raw string, doing the timestamp parsing for you that every
  other verified port leaves as text.

Two per-token facts survive across every one of these catalogs, because
they're facts about tmux, not about any one port's generator: `pane_dead_signal`
and `pane_dead_time` arrived in tmux 3.3, and a cluster of pane-geometry and
floating-pane tokens (`pane_floating_flag`, `pane_pb_progress`, `pane_x`,
`pane_y`, `pane_z`, `pane_zoomed_flag`, `bracket_paste_flag`,
`synchronized_output_flag`, among others) arrived together in 3.7.

## The two ports that didn't generate the full catalog

Swift's and C++'s `Session`/`Window`/`Pane` types both carry a small, fixed,
**non-optional** set of fields rather than exposing tmux's whole
format-token surface as optional properties the way the other six do:

- **Swift** carries `index`, `width`, `height`, `isActive`, `currentCommand`,
  `currentPath`, and the four edge flags.
- **C++** carries nineteen fields declared in one `kFields` array on each of
  `Session`, `Window`, and `Pane` — `id`, `command` (`pane_current_command`),
  `active`, `index`, `title`, `pid`, `tty`, `path`, `width`, `height`,
  `dead`, `in_mode`, the four edge flags, and `piping`, each returned as a
  plain `std::string_view`, `bool`, or `long long` — never a
  `std::optional`.

```swift
pane.isActive       // Bool, not Bool? — always populated, never gated
pane.currentCommand // String, likewise
```

```cpp
pane->active();  // bool, not std::optional<bool>
pane->command(); // std::string_view, likewise
```

A token outside either curated set — `pane_dead_signal`, say — isn't a
missing struct field to check for absence; it's reached ad hoc instead of
through a property, and Swift's ad hoc path is different in kind, not just
spelling, from C++'s. C++ calls `pane->expand("#{pane_dead_signal}")`, a
one-shot method whose own doc comment names exactly this trade-off ("neither
is a field this class carries: both change under a value that stays still").
Swift has no one-shot equivalent on `Pane` itself: reaching an uncurated
token means subscribing to it on an open control connection instead —
`FormatSubscription`, delivered as a `SubscriptionChange` whenever tmux next
re-evaluates it — which answers "what does this become," not "what is this
right now."
Both trace back to the same architectural choice covered in
[Architecture](../architecture/): neither language's `Session`/`Window`/
`Pane` is a per-instance query engine the way Python's dataclass or Rust's
struct is, so there's nowhere on the type itself to hang two hundred
gated properties — a fixed field set plus an escape hatch stands in for it.

## Fields promoted from the active child

Python's objects report a few fields that don't obviously belong to them —
`session.pane_id` gives you the pane ID of the session's *active window's*
active pane, not something the session owns directly:

```python
>>> session = server.new_session()
>>> session.pane_id == session.active_window.active_pane.pane_id
True
```

This falls out of tmux's own format engine, which includes the active
child's fields when it lists a parent (`list-sessions -F` includes
`pane_id`, `window_id`, and friends for each session's current window and
pane) — it isn't a Python-specific convenience. Whether another port's
typed session object exposes those same fields directly, rather than only
through the explicit accessor methods in [Traversal](../traversal/)
(`session.active_window()` / `window.active_pane()` and their per-port
spellings), wasn't checked against each port's own field list for this
page — treat it as a tmux-level fact with a Python-verified example, not a
claim about the other seven ports' structs.

The relationship is one-way regardless of port: a pane's own fields include
its parent window's and session's tokens, but a session's fields don't
include an attached client's — tmux can't infer *which* one client to
promote from a session row the way it can infer the one active window.
Client-scoped tokens (`client_name`, and the rest) appear only on rows
`list-clients` produces.
