---
title: Options and hooks
description: Reading and writing tmux's own configuration knobs, and binding commands to its events, at whichever scope you're holding.
sidebar:
  label: Options and hooks
  group: Topics
  order: 6
tableOfContents: true
---

tmux itself keeps two kinds of settings you can reach through any port:
*options* — values like `automatic-rename` or the status-line format — and
*hooks* — commands tmux runs when something happens, such as
`session-renamed` or `after-split-window`. Every port gives you one
consistent way to read, set, and remove both, at whichever scope you're
holding — server, session, window, or pane — and most scripts never need
either: reach for this only when you want to tweak how a session behaves or
react to something inside it.

## Reading and writing options

The four operations — read what's set, read one value, write a value,
remove it — show up in every port, but two shapes for "read" split them:
some ports separate "what's set at this exact scope" from "what's actually
in effect once inheritance is resolved," and some don't expose that
distinction at all.

| Port | Read all (this scope) | Read effective/inherited | Set | Unset |
|------|--------------------------|-----------------------------|-----|-------|
| Python | `pane.show_options()` | `pane.show_option(name, global_=True)` reaches the global fallback explicitly; no separate "resolved" call | `pane.set_option(name, value)` | `pane.unset_option(name)` |
| TypeScript | `pane.showOptions()` | `pane.showResolvedOptions()` | `pane.setOption(name, value)` | `pane.unsetOption(name)` |
| Go | `pane.Options(ctx)` — a typed struct with one accessor method per option | — | `pane.SetOption(ctx, ...)` | `pane.UnsetOption(ctx, ...)` |
| Rust | `pane.options()` (typed `BTreeMap`), `pane.option_names()` | `pane.typed_option(name)` decodes one value by its declared kind | `pane.set_option(name, value)`, `pane.append_option(name, value)` | `pane.unset_option(name)` |
| Java | `pane.options().all()` | `pane.options().get(name)` reads `show-options -A -v` — inherited, not just local | `pane.options().set(name, value)` | `pane.options().unset(name)` |
| .NET | `pane.Options.GetAllAsync()` | `pane.Options.GetAsync(new GetOptionRequest(name, includeInherited: true))` — an explicit opt-in flag, mapped straight to tmux's own `-A` | `pane.Options.SetAsync(new SetOptionRequest(name, value))` | `pane.Options.UnsetAsync(...)` |
| C++ | `pane->options()` | — | `pane->set_option(name, value)` | `pane->unset_option(name)` |
| Swift | `server.options(.pane(pane))` | `server.option(name, scope: .pane(pane))` reads presence from the listing, then the value with `-v` | `server.setOption(name, to: value, scope: .pane(pane))` | `server.unsetOption(name, scope: .pane(pane))` |

Every port's writes return the object (or complete) synchronously with the
change already live — none of them need a `refresh()` before the new value
reads back. Set, read, and unset one pane option, in each port:

```python
pane.set_option("automatic-rename", "off")
pane.show_options()
pane.unset_option("automatic-rename")
```

```typescript
await pane.setOption("automatic-rename", "off");
await pane.showOptions();
await pane.unsetOption("automatic-rename");
```

```go
pane.SetOption(ctx, "automatic-rename", "off", tmux.SetOptionOptions{})
pane.Options(ctx)
pane.UnsetOption(ctx, "automatic-rename", tmux.UnsetOptionOptions{})
```

```rust
pane.set_option("automatic-rename", "off").await?;
pane.options().await?;
pane.unset_option("automatic-rename").await?;
```

```java
pane.options().set("automatic-rename", "off");
pane.options().all();
pane.options().unset("automatic-rename");
```

```csharp
await pane.Options.SetAsync(new SetOptionRequest("automatic-rename", "off"));
await pane.Options.GetAllAsync();
await pane.Options.UnsetAsync("automatic-rename");
```

```cpp
pane->set_option("automatic-rename", "off");
pane->options();
pane->unset_option("automatic-rename");
```

```swift
try await server.setOption("automatic-rename", to: "off", scope: .pane(pane))
try await server.options(.pane(pane))
try await server.unsetOption("automatic-rename", scope: .pane(pane))
```

## Hooks

| Port | Set | Unset | List | Run now, without the event |
|------|-----|-------|------|--------------------------------|
| Python | `pane.set_hook(name, command)` | `pane.unset_hook(name)` | `pane.show_hook(name)`, `pane.show_hooks()` (all) | — |
| TypeScript | `pane.setHook(name, command, { append })` | `pane.unsetHook(name)` | `pane.showHooks()` (all; no singular `showHook`) | — |
| Go | `pane.SetHook(ctx, name, command)`, `pane.SetHooks(ctx, ...)` (bulk) | `pane.UnsetHook(ctx, name)` | `pane.Hooks(ctx)` — typed struct | — |
| Rust | `pane.set_hook(name, command)` | `pane.unset_hook(name)` | `pane.hook(name)` — one name only; **no listing at pane/window scope**, by design (see below) | — |
| Java | `pane.hooks().set(event, command)`, `.append(event, command)` | `pane.hooks().unset(event)` | `pane.hooks().all()` | `pane.hooks().run(event)` — tmux's `set-hook -R` |
| .NET | `pane.Hooks.SetAsync(new SetHookRequest(event, command))` | `pane.Hooks.UnsetAsync(...)` | `pane.Hooks.GetAllAsync()` | `pane.Hooks.RunAsync(...)` |
| C++ | `session.set_hook(name, command)` — no `Window`/`Pane` overload exists at all | — | `session.hooks()`, `server.global_hooks()` | — |
| Swift | `server.setHook(name, to: command, at: index, in: scope)` | `server.unsetHook(name, in: scope)` | `server.hooks(scope)` | `server.runHook(name, in: scope)` |

A single event can bind more than one command — tmux stores hooks as
arrays, indexed (`after-new-window[0]`, `after-new-window[1]`), and every
port's "set" either replaces the whole array or appends to it: Python and
TypeScript take the index in the hook name itself
(`'after-split-window[1]'`); Go's `SetHooks` and Swift's `at:` parameter
take it separately; Java's and TypeScript's `.append()` / `{ append: true }`
add without needing to know the next free index at all.

Set and list a session hook, in each port — session scope, deliberately,
since the next section covers why window and pane scope are a trap here:

```python
session.set_hook("session-renamed", "display-message 'renamed'")
session.show_hooks()
```

```typescript
await session.setHook("session-renamed", "display-message 'renamed'");
await session.showHooks();
```

```go
session.SetHook(ctx, "session-renamed", "display-message 'renamed'")
session.Hooks(ctx)
```

```rust
session.set_hook("session-renamed", "display-message 'renamed'").await?;
session.hooks().await?;
```

```java
session.hooks().set("session-renamed", "display-message 'renamed'");
session.hooks().all();
```

```csharp
await session.Hooks.SetAsync(new SetHookRequest("session-renamed", "display-message 'renamed'"));
await session.Hooks.GetAllAsync();
```

```cpp
session.set_hook("session-renamed", "display-message 'renamed'");
session.hooks(); // no unset — see the Unset column above
```

```swift
try await server.setHook("session-renamed", to: "display-message 'renamed'", in: .session(session.id.rawValue))
try await server.hooks(.session(session.id.rawValue))
```

## Window and pane hook scopes are mostly fiction

This is a tmux-level fact, not a per-port choice, and it's easy to miss
because tmux's own `set-hook -w` / `-p` flags report success either way.
tmux keeps exactly **two** hook tables: global, and one per session. A
window or pane scope you pass to `set-hook` is accepted and then silently
discarded — the command exits 0, but the hook lands in the session's table
regardless, and `show-hooks` has no per-window or per-pane listing to read
it back from at all.

Verified two independent ways:

- **Java's `Hooks.java`** states it outright: "Setting one at a scope it
  does not belong to is accepted and then silently discarded, on every
  supported release — so a hook that never fires is worth checking against
  `.all()` before it is worth debugging."
- **Rust actively guards against it.** `Pane::set_hook` and `Window::set_hook`
  document returning `Error::OptionScopeMismatch` rather than tmux's
  silent success — Rust checks the name against where tmux actually keeps
  it and refuses the call instead of letting it silently go nowhere.
- **Swift's `HookScope` enum only has two cases, `.global` and `.session`**,
  and **C++'s `Window` and `Pane` types have no `hooks()` or `set_hook()` at
  all** — `set_hook` exists only on `Session` (and `global_hooks()` on
  `Server`). Both close off the mistake by leaving it unrepresentable in the
  type, rather than catching it at runtime the way Rust does.

If a hook you set on a window or a pane never seems to fire, this is the
first thing to check — in every port, not just the ones above that happen
to document or guard against it. Plain *options*, unlike hooks, do have real
per-window and per-pane tables; this caveat is specific to hooks.

## tmux version compatibility

Python's own compatibility table records the tmux floor for this API
surface, verified against that port's source:

| Feature | Minimum tmux |
|---------|-------------|
| All options/hooks features | 3.2+ |
| Window/pane hook *scope flags* (`-w`, `-p`) accepted | 3.2+ — see the caveat above for what "accepted" actually gets you |
| `client-active`, `window-resized` hooks | 3.3+ |
| `pane-title-changed` hook | 3.5+ |

Whether another port's floor differs for any of these was not verified for
this page — check that port's own compatibility notes before relying on a
specific version across all eight.
