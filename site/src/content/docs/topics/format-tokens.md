---
supportedPorts: [py, ts, rs, go, java, csharp, cxx, swift]
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
accessor, object scope, tmux version, and data requested by the read.

A token needs the right **scope** and **tmux version**. For example, a pane
token needs a pane context, and a token added after your tmux release may be
absent. Check the accessor's result before using a field that can be missing, as
described below.

<a id="the-absence-idiom-per-port"></a>

## Handling an absent field

<!-- port:py -->
<!-- port:root -->
### Python
<!-- /port -->
An excluded field has the value `None`.
<!-- /port -->

<!-- port:ts -->
<!-- port:root -->
### TypeScript
<!-- /port -->
An excluded field has the value `undefined`.
<!-- /port -->

<!-- port:go -->
<!-- port:root -->
### Go
<!-- /port -->
Accessors return a value and a boolean when a field can be unavailable.
For example, `Pane.DeadSignal` returns `(string, bool)`; check the boolean
before using the string.
<!-- /port -->

<!-- port:rs -->
<!-- port:root -->
### Rust
<!-- /port -->
Some handle accessors return `Option<T>` for unavailable values.
Check the reference for the selected accessor and its return type.
<!-- /port -->

<!-- port:java -->
<!-- port:root -->
### Java
<!-- /port -->
Accessors use `Optional<T>` for fields that may be unavailable.
For example, `Pane.floating` returns an empty `Optional<Boolean>` when
that field is not populated.
<!-- /port -->

<!-- port:csharp -->
<!-- port:root -->
### C#
<!-- /port -->
A nullable value represents an absent value. A field that was not
captured can instead raise `IncompleteSnapshotException`.
<!-- /port -->

<!-- port:cxx -->
<!-- port:root -->
### C++
<!-- /port -->
Handles expose fixed, non-optional fields. See below for accessing
tokens outside that fixed set.
<!-- /port -->

<!-- port:swift -->
<!-- port:root -->
### Swift
<!-- /port -->
Snapshots expose fixed, non-optional fields. See below for accessing
tokens outside that fixed set.
<!-- /port -->

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

<!-- port:rs -->
`crates/libtmux/src/formats.rs` marks this token as optional. Consult the
reference for the accessor name.
<!-- /port -->

<!-- port:csharp -->
Missing values differ from incomplete captures. `Pane.Title` is
nullable because tmux may report no title. `Pane.Height`, `.Width`, and `.Index`
throw `IncompleteSnapshotException` when the read that produced the handle did
not request those fields. A handle resolved by ID alone may therefore lack
enough data to answer:

```csharp
string? title = pane.Title;   // nullable: the ordinary absence case
int height = pane.Height;     // throws IncompleteSnapshotException instead,
                               // if this Pane wasn't captured with a full listing
```
<!-- /port -->

<a id="a-generated-table-under-the-accessor"></a>

## Field availability

Field accessors retain the scope and version requirements of tmux tokens.

<!-- port:ts -->
<!-- port:root -->
### TypeScript
<!-- /port -->
`packages/libtmux/src/_generated/format_fields.ts` records each token's
scope and first tmux version. For example, `pane_zoomed_flag` has pane scope
and requires tmux 3.7. `packages/libtmux/src/_generated/field_aliases.ts`
supplies the camelCase alias `pane.zoomedFlag`.
<!-- /port -->

<!-- port:rs -->
<!-- port:root -->
### Rust
<!-- /port -->
`crates/libtmux/src/formats.rs` records each token's tmux name, required
context, first supported release, decoder, and handling of empty values.
`pane_dead_signal` requires pane context and tmux 3.3. Its text value
preserves arbitrary non-NUL bytes.
<!-- /port -->

<!-- port:go -->
<!-- port:root -->
### Go
<!-- /port -->
`tmux/internal/generate/formats/` generates `tmux/format_generated.go`.
Some accessors also parse the returned text: `Pane.DeadTime` returns
`(time.Time, bool)`, so the caller does not need to parse the timestamp.
<!-- /port -->

Version gates describe tmux behavior: `pane_dead_signal`
and `pane_dead_time` arrived in tmux 3.3, and a cluster of pane-geometry and
floating-pane tokens (`pane_floating_flag`, `pane_pb_progress`, `pane_x`,
`pane_y`, `pane_z`, `pane_zoomed_flag`, `bracket_paste_flag`,
`synchronized_output_flag`, among others) arrived together in 3.7.

<!-- port:cxx,swift -->
<a id="the-two-ports-that-didnt-generate-the-full-catalog"></a>

## Fixed fields and additional tokens

`Session`, `Window`, and `Pane` expose a fixed set of captured fields:

<!-- port:swift -->
<!-- port:root -->
### Swift
<!-- /port -->
Captured pane fields include `index`, `width`, `height`, `isActive`,
`currentCommand`, `currentPath`, and the four edge flags.
<!-- /port -->

<!-- port:cxx -->
<!-- port:root -->
### C++
<!-- /port -->
The `kFields` arrays declare which fields to capture. Pane fields include
`id`, `command`, `active`, `index`, `title`, `pid`, `tty`, `path`, `width`,
`height`, `dead`, `in_mode`, edge flags, and `piping`. Accessors return
`std::string_view`, `bool`, or `long long`.
<!-- /port -->

```swift
pane.isActive       // Bool, not Bool?: always populated, never gated
pane.currentCommand // String, likewise
```

```cpp
pane->active();  // bool, not std::optional<bool>
pane->command(); // std::string_view, likewise
```

<!-- port:cxx -->
Expand a token outside the fixed fields with
`pane->expand("#{pane_dead_signal}")`.
<!-- /port -->
<!-- port:swift -->
Use `FormatSubscription` on a control connection to observe other tokens.
It delivers `SubscriptionChange` when tmux re-evaluates the token.
<!-- /port --> [Architecture](../architecture/)
describes the fixed-field model.
<!-- /port -->

## Fields promoted from the active child

<!-- port:py -->
Python exposes fields promoted from an active child. For example,
`session.pane_id` identifies the active pane of the session's active window:

```python
>>> session = server.new_session()
>>> session.pane_id == session.active_window.active_pane.pane_id
True
```
<!-- /port -->

tmux's format engine includes active-child fields when listing a parent. A
`list-sessions -F` row can include `window_id` and `pane_id` for the active
window and pane. Check the port reference for typed access to those fields, or
use the explicit relationships described in [Traversal](../traversal/).

A pane context can include parent window and session fields. A session cannot
identify one attached client when several clients may be attached, so client
tokens such as `client_name` require a client context.
