---
supportedPorts: [py, ts, rs, go, java, dotnet, cxx, swift]
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

<!-- port:py,ts,go,rs,java,dotnet,cxx -->
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
if err := pane.SendKeys(ctx, tmux.SendKeysRequest{Command: &cmd, Literal: true}); err != nil {
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

## A generated data table under a hand-written surface

Ports translate object IDs into tmux targets (`-t`) and read state through
tmux's `FORMATS` variables (`#{...}`). Their field definitions use generated
catalogs, fixed field sets, or captured dictionaries:

| Port | Generated table | Hand-written surface |
|------|-------------------|----------------------|
<!-- port:py -->| Python | `libtmux.constants` (`FORMATS`, gated by scope and tmux version) | dataclass fields on `Obj` (`libtmux.neo`), `None` when a gate excludes a token |
<!-- /port --><!-- port:ts -->| TypeScript | `packages/libtmux/src/_generated/format_fields.ts` (`{ scope, since, token }` per row) | camelCase aliases on `Pane`/`Session`/`Window` (`packages/libtmux/src/_generated/field_aliases.ts`) |
<!-- /port --><!-- port:go -->| Go | `format_generated.go`, `option_generated.go` (built by `internal/generate/formats`) | `(value, bool)` accessor methods: Go's own "comma ok" idiom for a gate |
<!-- /port --><!-- port:rs -->| Rust | `formats.rs`'s per-token macro rows (`token, wire name, scope, kind, since version, absent-handling`) | typed methods returning `Option<T>` |
<!-- /port --><!-- port:java -->| Java | (typed field accessors generated for the query layer: see `Pane_`/`Session_` in [Filtering and queries](/concepts/queries/)) | `Optional<T>` for fields introduced after a port's tmux floor |
<!-- /port --><!-- port:cxx -->
| C++ | fixed field sets | non-optional fields |
<!-- /port -->
<!-- port:swift -->
| Swift | fixed field sets | non-optional fields |
<!-- /port -->
<!-- port:dotnet -->| .NET | a snapshot dictionary read at capture time | typed properties that throw `IncompleteSnapshotException` for a field the capture didn't request, rather than gating on tmux version per field |
<!-- /port -->
<!-- port:swift -->
The captured fields include indices, dimensions, active state, command, path,
and edge flags. [Format-token fields](../format-tokens/) covers other tokens.
<!-- /port -->
<!-- port:cxx -->
Use `pane->expand("#{...}")` for tokens outside the fixed fields.
[Format-token fields](../format-tokens/) covers their interpretation.
<!-- /port -->

<a id="module-layout-by-port"></a>

## Source layout

Use these entry points when inspecting the implementation:

<!-- port:py -->
- **Python**: one module per tier (`libtmux.server`, `.session`, `.window`,
  `.pane`, `.client`), plus `libtmux.common` for shared plumbing,
  `libtmux.neo` for the dataclass query layer, `libtmux.options` /
  `libtmux.hooks` as mixins every tier includes, and `libtmux.exc` for the
  exception hierarchy.
<!-- /port -->

<!-- port:ts -->
- **TypeScript**: `packages/libtmux/src/{server,session,window,pane,client}.ts`
  hold the public classes; nearly everything they call into lives under
  `_internal/operations/` (one file per concern: `pane_io.ts`, `hooks.ts`,
  `options.ts`, `topology.ts`) and `_generated/` (the format/option/hook
  catalogs above). Separate packages in the same monorepo cover workspaces
  (`@libtmux/workspace`) and an MCP server.
<!-- /port -->

<!-- port:go -->
- **Go**: a single `tmux` package, split by concern into many files rather
  than many packages (`model.go` for the core structs, `lifecycle_kill.go`,
  `pane_capture.go`, `pane_geometry.go`, `hierarchy.go`, `plan_server.go`
  for folded invocations); `tmuxq` is a separate package for predicate
  queries over an already-read snapshot ([Filtering and
  queries](/concepts/queries/)), and `workspace` a separate one again.
<!-- /port -->

<!-- port:rs -->
- **Rust**: `crates/libtmux/src/{server,session,window,pane}/` directories,
  each split into files by concern (a `settings.rs` per tier holding that
  tier's options-and-hooks methods, matching the pattern in [Options and
  hooks](../options-and-hooks/)); `hooks.rs`, `options.rs`, and `formats.rs`
  hold the shared, scope-generic machinery those call into. Workspaces and
  the MCP server are separate crates in the same workspace.
<!-- /port -->

<!-- port:java -->
- **Java**: `io.github.libtmux` holds `Server`, `Session`, `Window`, and
  `Pane` as `final` classes; each exposes its option and hook tables through
  `.options()` / `.hooks()` accessor methods returning a separate `Options`
  / `Hooks` view scoped to that object, rather than mixing those methods
  directly into the entity class. `Session_`,
  `Window_`, and `Pane_` are a parallel set of typed-field classes that
  exist only for the query layer.
<!-- /port -->

<!-- port:dotnet -->
- **.NET**: `src/LibTmux/` gives every entity its own name (`Pane.cs`,
  `Session.cs`, ...) but splits each into several `partial class` files by
  concern rather than by inheritance: `Pane.Capture.cs`, `Pane.Input.cs`,
  `Pane.Relations.cs`, `Pane.Scopes.cs`, `Pane.Topology.cs`, and so on all
  contribute to one `Pane` type. `Options`/`Hooks` are reached through
  `.Options` / `.Hooks` properties.
<!-- /port -->

<!-- port:cxx -->
- **C++**: `include/libtmux/entities.hpp` declares `Session`, `Window`, and
  `Pane` together as value types (`private Row` bases), with their method
  bodies in `src/` rather than the header; `server.hpp`, `options.hpp`, and
  `capabilities.hpp` are separate headers.
  A private `testing` component (`include/libtmux/testing/`) ships
  separately from the library proper: see [Context
  managers](../context-managers/) for what it's for.
<!-- /port -->

<!-- port:swift -->
- **Swift**: `Sources/LibTmux/Server.swift` is the hub every operation
  extends; `Session.swift` and `Pane.swift` declare the thin value types,
  `Snapshot.swift` holds the relationship queries
  ([Traversal](../traversal/)), and `Options.swift`, `PaneInteraction.swift`,
  and `Mutations.swift` are `extension Server` files grouping options/hooks,
  send/capture, and kill respectively: all reachable only through `Server`,
  per the section above.
<!-- /port -->

<!-- port:root -->
## Naming conventions

Method names follow language conventions: Python, Rust, and C++ use
`snake_case`; TypeScript, Java, and Swift use `camelCase`; Go and .NET use
`PascalCase`. Option and hook names remain tmux's dash-separated strings, such
as `automatic-rename`, regardless of the method's spelling.
<!-- /port -->
