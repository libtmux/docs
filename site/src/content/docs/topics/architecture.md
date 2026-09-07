---
title: Architecture
description: The object hierarchy underneath the API you call, and who actually holds the behavior in each port.
sidebar:
  label: Architecture
  group: Topics
  order: 2
tableOfContents: true
---

This page describes how the language ports organize their code and where
operations live. For the object hierarchy and stable IDs, start with [Server,
session, window, pane](/concepts/server-session-window-pane/).

## Where behavior lives: on the object, or through the server

Python, TypeScript, Go, Rust, Java, .NET, and C++ provide operations on session,
window, and pane objects. Each object carries its ID and server context. These
examples send input, set an option, and kill a pane:

```python
pane.send_keys("echo hi")
pane.set_option("automatic-rename", "off")
pane.kill()
```

```typescript
await pane.sendKeys("echo hi");
await pane.setOption("automatic-rename", "off");
await pane.kill();
```

```go
pane.SendKeys(ctx, tmux.SendKeysRequest{Command: &cmd})
pane.SetOption(ctx, "automatic-rename", "off", tmux.SetOptionOptions{})
pane.Kill(ctx)
```

```rust
pane.send_line("echo hi").await?;
pane.set_option("automatic-rename", "off").await?;
pane.kill().await?; // consumes the handle: see Context managers
```

```java
pane.sendLine("echo hi");
pane.options().set("automatic-rename", "off");
pane.kill();
```

```csharp
await pane.SendTextAsync("echo hi");
await pane.Options.SetAsync(new SetOptionRequest("automatic-rename", "off"));
await pane.KillAsync();
```

```cpp
pane->send_text("echo hi");
pane->set_option("automatic-rename", "off");
pane->kill();
```

Swift's `Session`, `Window`, and `Pane` are `Sendable` value types holding IDs
and state fields. [Format-token fields](../format-tokens/) lists their fields.
Perform operations through `Server`, passing the target value:

```swift
try await server.sendKeys(["echo hi", "Enter"], to: pane)
try await server.setOption("automatic-rename", to: "off", scope: .window(window))
try await server.kill(pane)
```

The practical effect is that `Server` is the one thing you hold onto in a
Swift program; a `Session` or `Pane` you got back from a `snapshot()` is
inert data you hand back to the server that produced it, not a handle you
call things on. Every other port's `Server` is also where you start, but
`Session`/`Window`/`Pane` stay live actors once you have one.

## A generated data table under a hand-written surface

Ports translate object IDs into tmux targets (`-t`) and read state through
tmux's `FORMATS` variables (`#{...}`). Their field definitions use generated
catalogs, fixed field sets, or captured dictionaries:

| Port | Generated table | Hand-written surface |
|------|-------------------|----------------------|
| Python | `libtmux.constants` (`FORMATS`, gated by scope and tmux version) | dataclass fields on `Obj` (`libtmux.neo`), `None` when a gate excludes a token |
| TypeScript | `packages/libtmux/src/_generated/format_fields.ts` (`{ scope, since, token }` per row) | camelCase aliases on `Pane`/`Session`/`Window` (`packages/libtmux/src/_generated/field_aliases.ts`) |
| Go | `format_generated.go`, `option_generated.go` (built by `internal/generate/formats`) | `(value, bool)` accessor methods: Go's own "comma ok" idiom for a gate |
| Rust | `formats.rs`'s per-token macro rows (`token, wire name, scope, kind, since version, absent-handling`) | typed methods returning `Option<T>` |
| Java | (typed field accessors generated for the query layer: see `Pane_`/`Session_` in [Filtering and queries](/concepts/queries/)) | `Optional<T>` for fields introduced after a port's tmux floor |
| C++, Swift | fixed field sets; see below | a fixed, curated set of non-optional struct/class fields |
| .NET | a snapshot dictionary read at capture time | typed properties that throw `IncompleteSnapshotException` for a field the capture didn't request, rather than gating on tmux version per field |

Swift and C++ expose fixed sets of state fields. Swift includes indices,
dimensions, active state, command, path, and edge flags. C++ declares its fields
in `kFields` arrays and uses `pane->expand("#{...}")` for other tokens. See
[Format-token fields](../format-tokens/) for optional fields and tokens outside
the fixed sets.

## Module layout, by port

Each port's own top-level organization, to orient yourself before opening
its source:

- **Python**: one module per tier (`libtmux.server`, `.session`, `.window`,
  `.pane`, `.client`), plus `libtmux.common` for shared plumbing,
  `libtmux.neo` for the dataclass query layer, `libtmux.options` /
  `libtmux.hooks` as mixins every tier includes, and `libtmux.exc` for the
  exception hierarchy.
- **TypeScript**: `packages/libtmux/src/{server,session,window,pane,client}.ts`
  hold the public classes; nearly everything they call into lives under
  `_internal/operations/` (one file per concern: `pane_io.ts`, `hooks.ts`,
  `options.ts`, `topology.ts`) and `_generated/` (the format/option/hook
  catalogs above). Separate packages in the same monorepo cover workspaces
  (`@libtmux/workspace`) and an MCP server.
- **Go**: a single `tmux` package, split by concern into many files rather
  than many packages (`model.go` for the core structs, `lifecycle_kill.go`,
  `pane_capture.go`, `pane_geometry.go`, `hierarchy.go`, `plan_server.go`
  for folded invocations); `tmuxq` is a separate package for predicate
  queries over an already-read snapshot ([Filtering and
  queries](/concepts/queries/)), and `workspace` a separate one again.
- **Rust**: `crates/libtmux/src/{server,session,window,pane}/` directories,
  each split into files by concern (a `settings.rs` per tier holding that
  tier's options-and-hooks methods, matching the pattern in [Options and
  hooks](../options-and-hooks/)); `hooks.rs`, `options.rs`, and `formats.rs`
  hold the shared, scope-generic machinery those call into. Workspaces and
  the MCP server are separate crates in the same workspace.
- **Java**: `io.github.libtmux` holds `Server`, `Session`, `Window`, and
  `Pane` as `final` classes; each exposes its option and hook tables through
  `.options()` / `.hooks()` accessor methods returning a separate `Options`
  / `Hooks` view scoped to that object, rather than mixing those methods
  directly into the entity class the way Python and Go do. `Session_`,
  `Window_`, and `Pane_` are a parallel set of typed-field classes that
  exist only for the query layer.
- **.NET**: `src/LibTmux/` gives every entity its own name (`Pane.cs`,
  `Session.cs`, ...) but splits each into several `partial class` files by
  concern rather than by inheritance: `Pane.Capture.cs`, `Pane.Input.cs`,
  `Pane.Relations.cs`, `Pane.Scopes.cs`, `Pane.Topology.cs`, and so on all
  contribute to one `Pane` type. `Options`/`Hooks` are reached through
  `.Options` / `.Hooks` properties, structurally the same idea as Java's
  accessor methods.
- **C++**: `include/libtmux/entities.hpp` declares `Session`, `Window`, and
  `Pane` together as value types (`private Row` bases), with their method
  bodies in `src/` rather than the header; `server.hpp`, `options.hpp`, and
  `capabilities.hpp` are separate headers.
  A private `testing` component (`include/libtmux/testing/`) ships
  separately from the library proper: see [Context
  managers](../context-managers/) for what it's for.
- **Swift**: `Sources/LibTmux/Server.swift` is the hub every operation
  extends; `Session.swift` and `Pane.swift` declare the thin value types,
  `Snapshot.swift` holds the relationship queries
  ([Traversal](../traversal/)), and `Options.swift`, `PaneInteraction.swift`,
  and `Mutations.swift` are `extension Server` files grouping options/hooks,
  send/capture, and kill respectively: all reachable only through `Server`,
  per the section above.

## Naming conventions

Method names follow language conventions: Python, Rust, and C++ use
`snake_case`; TypeScript, Java, and Swift use `camelCase`; Go and .NET use
`PascalCase`. Option and hook names remain tmux's dash-separated strings, such
as `automatic-rename`, regardless of the method's spelling.
