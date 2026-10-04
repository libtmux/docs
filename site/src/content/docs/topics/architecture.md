---
supportedPorts: [py, ts, rs, go, java, csharp, cxx, swift]
title: Architecture
description: Locate operations, distinguish snapshots from live commands, and find their implementation.
sidebar:
  label: Architecture
  group: Topics
  order: 2
tableOfContents: true
---

A server handle selects a tmux server. Object IDs select sessions, windows, and
panes within it. For the object hierarchy and stable IDs, start with [Server,
session, window, pane](/concepts/server-session-window-pane/).

<a id="where-behavior-lives-on-the-object-or-through-the-server"></a>

## Calling operations

<!-- port:py,ts,go,rs,java,csharp,cxx -->
Session, window, and pane handles carry their ID and server context. Call an
operation on the object you want to change. The examples below send input and
kill that pane.
<!-- /port -->

```python
pane.send_keys("echo hi")
pane.kill()
```

```typescript
await pane.sendKeys("echo hi");
await pane.kill();
```

```go
cmd := "printf 'hello\\n'"
err := pane.SendKeys(ctx, tmux.SendKeysRequest{
    Command: &cmd,
    Literal: true,
})
if err != nil {
    return err
}
if err := pane.Kill(ctx); err != nil {
    return err
}
```

```rust
pane.send_line("echo hi").await?;
pane.kill().await?; // consumes the handle: see Context managers
```

```java
pane.sendLine("echo hi");
pane.kill();
```

```csharp
await pane.SendTextAsync("echo hi");
await pane.KillAsync();
```

```cpp
pane->send_text("echo hi");
pane->kill();
```

<!-- port:swift -->
Swift's `Session`, `Window`, and `Pane` are `Sendable` value types holding IDs
and state fields. [Format-token fields](../format-tokens/) lists their fields.
Perform operations through `Server`, passing the target value:

```swift
try await server.sendKeys(["echo hi", "Enter"], to: pane)
try await server.kill(pane)
```

Keep the `Server` that produced the snapshot. Pass its captured values back to
that server for operations.
<!-- /port -->

<a id="a-generated-data-table-under-a-hand-written-surface"></a>

## Reading tmux fields

Object IDs become tmux targets (`-t`). Format variables (`#{...}`) provide
the state returned by tmux.

<!-- port:py -->
<!-- port:root -->
### Python
<!-- /port -->
`libtmux.constants` defines the format fields and their scope and tmux-version
requirements. `Obj` in `libtmux.neo` exposes the captured values as dataclass
fields. A field excluded by those requirements is `None`.
<!-- /port -->

<!-- port:ts -->
<!-- port:root -->
### TypeScript
<!-- /port -->
`packages/libtmux/src/_generated/format_fields.ts` records each token's scope
and first tmux version. `packages/libtmux/src/_generated/field_aliases.ts`
provides camelCase aliases for fields on `Pane`, `Session`, and `Window`.
<!-- /port -->

<!-- port:go -->
<!-- port:root -->
### Go
<!-- /port -->
`tmux/format_generated.go` defines format fields, and
`tmux/option_generated.go` defines options. The format generator lives in
`tmux/internal/generate/formats/`. Accessors return a value and a boolean
when a field can be unavailable; check the boolean before using the value.
<!-- /port -->

<!-- port:rs -->
<!-- port:root -->
### Rust
<!-- /port -->
`crates/libtmux/src/formats.rs` defines the format catalog. Each entry records
the tmux name, required context, first supported release, decoder, and handling
of empty values. `crates/libtmux/src/snapshot.rs` uses that catalog to decode
captured fields.

Handle accessors such as `Pane.current_command` return `Option<T>` when a
value can be absent. Typed field queries return `Availability`, which also
distinguishes an unsupported field from an absent value. See
[Format-token fields](../format-tokens/) for field availability.
<!-- /port -->

<!-- port:java -->
<!-- port:root -->
### Java
<!-- /port -->
Typed field classes such as `Pane_` and `Session_` support the query layer.
Accessors use `Optional<T>` for fields that may be unavailable on the running
tmux version. [Filtering and queries](/concepts/queries/) explains how to
select and query those fields.
<!-- /port -->

<!-- port:csharp -->
<!-- port:root -->
### C#
<!-- /port -->
Typed properties read a dictionary captured from tmux. A property throws
`IncompleteSnapshotException` when the capture did not request its field.
This differs from a captured field whose value is absent.
<!-- /port -->

<!-- port:swift -->
<!-- port:root -->
### Swift
<!-- /port -->
Snapshots capture a fixed set of non-optional fields, including indices,
dimensions, active state, command, path, and edge flags.
[Format-token fields](../format-tokens/) covers other tokens.
<!-- /port -->

<!-- port:cxx -->
<!-- port:root -->
### C++
<!-- /port -->
Handles capture a fixed set of non-optional fields. Use
`pane->expand("#{...}")` for tokens outside those fields.
[Format-token fields](../format-tokens/) covers their interpretation.
<!-- /port -->

<a id="module-layout-by-port"></a>

## Source layout

<!-- port:py -->
<!-- port:root -->
### Python
<!-- /port -->
`Server`, `Session`, `Window`, `Pane`, and `Client` each have their own module:
`src/libtmux/server.py`, `src/libtmux/session.py`, `src/libtmux/window.py`,
`src/libtmux/pane.py`, and `src/libtmux/client.py`.

`src/libtmux/common.py` holds shared behavior. `src/libtmux/neo.py` defines
the dataclass query layer, `src/libtmux/options.py` and `src/libtmux/hooks.py`
provide mixins, and `src/libtmux/exc.py` defines the exception hierarchy.
<!-- /port -->

<!-- port:ts -->
<!-- port:root -->
### TypeScript
<!-- /port -->
The public classes live in `packages/libtmux/src/server.ts`,
`packages/libtmux/src/session.ts`, `packages/libtmux/src/window.ts`,
`packages/libtmux/src/pane.ts`, and `packages/libtmux/src/client.ts`.

Their operations are split by concern under
`packages/libtmux/src/_internal/operations/`, including
`packages/libtmux/src/_internal/operations/pane_io.ts`,
`packages/libtmux/src/_internal/operations/hooks.ts`,
`packages/libtmux/src/_internal/operations/options.ts`, and
`packages/libtmux/src/_internal/operations/topology.ts`.
`packages/libtmux/src/_generated/` contains the generated field catalogs.
Workspaces and the MCP server have separate packages in the same repository.
<!-- /port -->

<!-- port:go -->
<!-- port:root -->
### Go
<!-- /port -->
The `tmux` package groups its implementation by concern. `tmux/model.go`
defines the core structs. `tmux/lifecycle_kill.go`, `tmux/pane_capture.go`,
`tmux/pane_geometry.go`, and `tmux/hierarchy.go` implement lifecycle,
capture, geometry, and traversal. `tmux/plan_server.go` combines commands
into fewer invocations.

`tmuxq/` provides predicate queries over an already-read snapshot; see
[Filtering and queries](/concepts/queries/). Workspace support lives in
`workspace/`.
<!-- /port -->

<!-- port:rs -->
<!-- port:root -->
### Rust
<!-- /port -->
`Server`, `Session`, `Window`, and `Pane` are defined in
`crates/libtmux/src/server.rs`, `crates/libtmux/src/session.rs`,
`crates/libtmux/src/window.rs`, and `crates/libtmux/src/pane.rs`.
Their additional operations live in `crates/libtmux/src/server/`,
`crates/libtmux/src/session/`, `crates/libtmux/src/window/`, and
`crates/libtmux/src/pane/`.

The [options and hooks](../options-and-hooks/) methods are grouped in
`crates/libtmux/src/server/settings.rs`,
`crates/libtmux/src/session/settings.rs`,
`crates/libtmux/src/window/settings.rs`, and
`crates/libtmux/src/pane/settings.rs`.
`crates/libtmux/src/hooks.rs` defines `IndexedHooks` and `SparseValues`;
`crates/libtmux/src/options.rs` defines option schemas and values.
Workspaces and the MCP server are separate crates under
`crates/tmux-workspace/` and `crates/tmux-mcp/`.
<!-- /port -->

<!-- port:java -->
<!-- port:root -->
### Java
<!-- /port -->
`libtmux/src/main/java/io/github/libtmux/` holds the `Server`, `Session`,
`Window`, and `Pane` classes. Their `options()` and `hooks()` accessors
return `Options` and `Hooks` views scoped to the object.
`Session_`, `Window_`, and `Pane_` are typed-field classes for the query layer.
<!-- /port -->

<!-- port:csharp -->
<!-- port:root -->
### C#
<!-- /port -->
`src/LibTmux/` splits each entity into partial-class files by concern.
For example, `src/LibTmux/Pane.cs`, `src/LibTmux/Pane.Capture.cs`,
`src/LibTmux/Pane.Input.cs`, `src/LibTmux/Pane.Relations.cs`,
`src/LibTmux/Pane.Scopes.cs`, and `src/LibTmux/Pane.Topology.cs` contribute
to one `Pane` type. `Options` and `Hooks` views are reached through the
object's properties.
<!-- /port -->

<!-- port:cxx -->
<!-- port:root -->
### C++
<!-- /port -->
`include/libtmux/entities.hpp` declares `Session`, `Window`, and `Pane`.
Their method bodies live in `src/`. `include/libtmux/server.hpp`,
`include/libtmux/options.hpp`, and `include/libtmux/capabilities.hpp`
define server operations, options, and capability checks.

The `include/libtmux/testing/` component is separate from the library;
[Context managers](../context-managers/) explains its test-server ownership.
<!-- /port -->

<!-- port:swift -->
<!-- port:root -->
### Swift
<!-- /port -->
`Sources/LibTmux/Server.swift` defines `Server`. `Sources/LibTmux/Session.swift`,
`Sources/LibTmux/Window.swift`, and `Sources/LibTmux/Pane.swift` define the
snapshot value types. `Sources/LibTmux/Snapshot.swift` implements the
[relationship queries](../traversal/).

Extensions on `Server` group related operations:
`Sources/LibTmux/Options.swift` implements options and hooks,
`Sources/LibTmux/PaneInteraction.swift` handles input and capture, and
`Sources/LibTmux/Mutations.swift` handles changes such as killing a pane.
<!-- /port -->

<!-- port:root -->
## Naming conventions

Method names follow language conventions: Python, Rust, and C++ use
`snake_case`; TypeScript, Java, and Swift use `camelCase`; Go and C# use
`PascalCase`. Option and hook names remain tmux's dash-separated strings, such
as `automatic-rename`, regardless of the method's spelling.
<!-- /port -->
