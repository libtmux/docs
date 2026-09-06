---
title: Format-token fields
description: The typed fields every object exposes, mirroring tmux's own format tokens, and why a field is sometimes absent.
sidebar:
  label: Format-token fields
  group: Topics
  order: 7
tableOfContents: true
---

Object fields expose values from tmux's
[FORMATS](https://man.openbsd.org/tmux.1#FORMATS), such as `pane_id`,
`window_zoomed_flag`, and `session_name`. The available fields depend on the
port, object scope, tmux version, and data requested by the read.

A token needs the right **scope** and **tmux version**. For example, a pane
token needs a pane context, and a token added after your tmux release may be
absent. Ports represent absence with optional values, flags, or errors, as
described below.

## The absence idiom, per port

| Port | What an excluded field looks like |
|------|--------------------------------------|
| Python | the attribute is `None` |
| TypeScript | the property is `undefined` |
| Go | a two-return-value accessor: `pane.DeadSignal()` returns `(string, bool)`: Go's own "comma ok" idiom |
| Rust | `Option<T>`; consult the reference for the accessor name |
| Java | `Optional<T>`: `pane.floating()` returns `Optional<Boolean>`, empty when the field isn't populated |
| .NET | nullable values or `IncompleteSnapshotException`, depending on whether the value or captured field is absent |
| C++, Swift | fixed, non-optional fields; see below for access to other tokens |

These examples read optional fields, including `pane_dead_signal` on tmux 3.3 or
newer:

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
pane.floating(); // Optional<Boolean>: a different field, same idiom: empty
                  // rather than a sentinel when the token isn't populated
```

Rust's `formats.rs` marks this token as optional. Consult its generated
reference for the accessor name.

.NET also distinguishes missing values from incomplete captures. `Pane.Title` is
nullable because tmux may report no title. `Pane.Height`, `.Width`, and `.Index`
throw `IncompleteSnapshotException` when the read that produced the handle did
not request those fields. A handle resolved by ID alone may therefore lack
enough data to answer:

```csharp
string? title = pane.Title;   // nullable: the ordinary absence case
int height = pane.Height;     // throws IncompleteSnapshotException instead,
                               // if this Pane wasn't captured with a full listing
```

## A generated table under the accessor

Several ports generate scope- and version-tagged field catalogs from tmux source
or documentation. [Architecture](../architecture/) describes the layouts.
Examples include:

- **TypeScript** uses `_generated/format_fields.ts` rows with `scope`, `since`,
  and `token`. For example, `pane_zoomed_flag` has pane scope and requires tmux
  3.7. `_generated/field_aliases.ts` supplies the camelCase alias
  `pane.zoomedFlag`.
- **Rust** uses a macro row in `formats.rs` for each token's wire name, scope,
  tmux version, and type. `pane_dead_signal` has `Pane` scope, requires `V3_3`,
  and is decoded as `Text`.
- **Go** generates `format_generated.go` with `internal/generate/formats`. Some
  accessors decode richer values: `pane.DeadTime()` returns `(time.Time, bool)`
  and performs timestamp parsing for the caller.

Two per-token facts survive across every one of these catalogs, because
they're facts about tmux, not about any one port's generator: `pane_dead_signal`
and `pane_dead_time` arrived in tmux 3.3, and a cluster of pane-geometry and
floating-pane tokens (`pane_floating_flag`, `pane_pb_progress`, `pane_x`,
`pane_y`, `pane_z`, `pane_zoomed_flag`, `bracket_paste_flag`,
`synchronized_output_flag`, among others) arrived together in 3.7.

## The two ports that didn't generate the full catalog

Swift and C++ expose fixed, non-optional fields on `Session`, `Window`, and
`Pane`:

- **Swift** carries `index`, `width`, `height`, `isActive`, `currentCommand`,
  `currentPath`, and the four edge flags.
- **C++** declares fields in `kFields` arrays. Pane fields include `id`,
  `command`, `active`, `index`, `title`, `pid`, `tty`, `path`, `width`,
  `height`, `dead`, `in_mode`, edge flags, and `piping`. Accessors return
  `std::string_view`, `bool`, or `long long`.

```swift
pane.isActive       // Bool, not Bool?: always populated, never gated
pane.currentCommand // String, likewise
```

```cpp
pane->active();  // bool, not std::optional<bool>
pane->command(); // std::string_view, likewise
```

For a token outside the fixed fields, C++ provides one-shot expansion with
`pane->expand("#{pane_dead_signal}")`. Swift uses `FormatSubscription` on a
control connection, delivering `SubscriptionChange` when tmux re-evaluates the
token. That API observes changes over time. [Architecture](../architecture/)
describes the fixed-field model.

## Fields promoted from the active child

Python exposes fields promoted from an active child. For example,
`session.pane_id` identifies the active pane of the session's active window:

```python
>>> session = server.new_session()
>>> session.pane_id == session.active_window.active_pane.pane_id
True
```

tmux's format engine includes active-child fields when listing a parent. A
`list-sessions -F` row can include `window_id` and `pane_id` for the active
window and pane. Check the port reference for typed access to those fields, or
use the explicit relationships described in [Traversal](../traversal/).

A pane context can include parent window and session fields. A session cannot
identify one attached client when several clients may be attached, so client
tokens such as `client_name` require a client context.
