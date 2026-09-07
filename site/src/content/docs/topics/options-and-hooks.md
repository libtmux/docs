---
title: Options and hooks
description: Reading and writing tmux's own configuration knobs, and binding commands to its events, at whichever scope you're holding.
sidebar:
  label: Options and hooks
  group: Topics
  order: 6
tableOfContents: true
---

Use options to change tmux behavior, such as `automatic-rename` or the
status-line format. Use hooks to run commands on events such as
`session-renamed` or `after-split-window`. Choose the scope supported by the
option or hook.

## Reading and writing options

Read an option, set it, or unset it at a chosen scope. Ports differ in how they
distinguish values set locally from effective values inherited from another
scope:

### Python

**Read all (this scope):** `pane.show_options()`

**Read effective/inherited:** `pane.show_option(name, global_=True)` reaches the
global fallback explicitly; no separate "resolved" call

**Set:** `pane.set_option(name, value)`

**Unset:** `pane.unset_option(name)`

### TypeScript

**Read all (this scope):** `pane.showOptions()`

**Read effective/inherited:** `pane.showResolvedOptions()`

**Set:** `pane.setOption(name, value)`

**Unset:** `pane.unsetOption(name)`

### Go

**Read all (this scope):** `pane.Options(ctx)`: a typed struct with one
accessor method per option

**Read effective/inherited:** Not listed.

**Set:** `pane.SetOption(ctx, ...)`

**Unset:** `pane.UnsetOption(ctx, ...)`

### Rust

**Read all (this scope):** `pane.options()` (typed `BTreeMap`),
`pane.option_names()`

**Read effective/inherited:** `pane.typed_option(name)` decodes one value by its
declared kind

**Set:** `pane.set_option(name, value)`, `pane.append_option(name, value)`

**Unset:** `pane.unset_option(name)`

### Java

**Read all (this scope):** `pane.options().all()`

**Read effective/inherited:** `pane.options().get(name)` reads `show-options -A
-v`: inherited, not just local

**Set:** `pane.options().set(name, value)`

**Unset:** `pane.options().unset(name)`

### .NET

**Read all (this scope):** `pane.Options.GetAllAsync()`

**Read effective/inherited:** `pane.Options.GetAsync(new GetOptionRequest(name,
includeInherited: true))`: an explicit opt-in flag, mapped straight to tmux's
own `-A`

**Set:** `pane.Options.SetAsync(new SetOptionRequest(name, value))`

**Unset:** `pane.Options.UnsetAsync(...)`

### C++

**Read all (this scope):** `pane->options()`

**Read effective/inherited:** Not listed.

**Set:** `pane->set_option(name, value)`

**Unset:** `pane->unset_option(name)`

### Swift

**Read all (this scope):** `server.options(.pane(pane))`

**Read effective/inherited:** `server.option(name, scope: .pane(pane))` reads
presence from the listing, then the value with `-v`

**Set:** `server.setOption(name, to: value, scope: .pane(pane))`

**Unset:** `server.unsetOption(name, scope: .pane(pane))`

### Examples

After a successful write completes, read the option to obtain its updated value.
These examples set, read, and unset a pane option:

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

### Python

**Set:** `pane.set_hook(name, command)`

**Unset:** `pane.unset_hook(name)`

**List:** `pane.show_hook(name)`, `pane.show_hooks()` (all)

**Run now, without the event:** Not listed.

### TypeScript

**Set:** `pane.setHook(name, command, { append })`

**Unset:** `pane.unsetHook(name)`

**List:** `pane.showHooks()` (all; no singular `showHook`)

**Run now, without the event:** Not listed.

### Go

**Set:** `pane.SetHook(ctx, name, command)`, `pane.SetHooks(ctx, ...)` (bulk)

**Unset:** `pane.UnsetHook(ctx, name)`

**List:** `pane.Hooks(ctx)`: typed struct

**Run now, without the event:** Not listed.

### Rust

**Set:** `pane.set_hook(name, command)`

**Unset:** `pane.unset_hook(name)`

**List:** `pane.hook(name)`: one name only; **no listing at pane/window scope**,
by design (see below)

**Run now, without the event:** Not listed.

### Java

**Set:** `pane.hooks().set(event, command)`, `.append(event, command)`

**Unset:** `pane.hooks().unset(event)`

**List:** `pane.hooks().all()`

**Run now, without the event:** `pane.hooks().run(event)`: tmux's `set-hook -R`

### .NET

**Set:** `pane.Hooks.SetAsync(new SetHookRequest(event, command))`

**Unset:** `pane.Hooks.UnsetAsync(...)`

**List:** `pane.Hooks.GetAllAsync()`

**Run now, without the event:** `pane.Hooks.RunAsync(...)`

### C++

**Set:** `session.set_hook(name, command)`: no `Window`/`Pane` overload exists
at all

**Unset:** Not listed.

**List:** `session.hooks()`, `server.global_hooks()`

**Run now, without the event:** Not listed.

### Swift

**Set:** `server.setHook(name, to: command, at: index, in: scope)`

**Unset:** `server.unsetHook(name, in: scope)`

**List:** `server.hooks(scope)`

**Run now, without the event:** `server.runHook(name, in: scope)`

### Examples

tmux stores hook commands in indexed arrays, such as `after-new-window[0]`.
Python and TypeScript can include the index in the name. Go's `SetHooks` and
Swift's `at:` parameter take it separately. Java's `.append()` and TypeScript's
`{ append: true }` append without requiring the next index.

Set and list a session hook. The next section explains window and pane scope
limitations:

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
session.hooks(); // No session unset helper is listed above.
```

```swift
try await server.setHook("session-renamed", to: "display-message 'renamed'", in: .session(session.id.rawValue))
try await server.hooks(.session(session.id.rawValue))
```

<a id="window-and-pane-hook-scopes-are-mostly-fiction"></a>

## Supported hook scopes

tmux stores hooks globally or per session. Accepted `set-hook -w` or `-p` flags
do not imply a separate window or pane hook table, and `show-hooks` does not
provide a corresponding listing. Check the event's supported scope if a hook is
accepted but never fires.

Ports handle unsupported hook scopes differently:

- **Java's `Hooks.java`** documents that tmux can accept a hook at an
  unsupported scope without an effective registration. Check `.all()` when
  diagnosing a hook that does not fire.
- **Rust** validates scope in `Pane::set_hook` and `Window::set_hook`, returning
  `Error::OptionScopeMismatch` for an unsupported scope.
- **Swift** restricts `HookScope` to `.global` and `.session`. **C++** exposes
  `set_hook` on `Session` and `global_hooks()` on `Server`, with no window or
  pane hook methods.

Options have window and pane tables of their own. The hook-scope limitation does
not apply to ordinary options.

## tmux version compatibility

Python's compatibility notes list these tmux requirements:

| Feature | Minimum tmux |
|---------|-------------|
| All options/hooks features | 3.2+ |
| Window/pane hook *scope flags* (`-w`, `-p`) accepted | 3.2+; see the supported-scope caveat above |
| `client-active`, `window-resized` hooks | 3.3+ |
| `pane-title-changed` hook | 3.5+ |

Check your port's compatibility notes before relying on a particular tmux
release.
