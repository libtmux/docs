---
supportedPorts: [py, ts, rs, go, java, csharp, cxx, swift]
title: Options and hooks
description: Read and update tmux options, and register commands for tmux events.
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

Read, set, or unset an option at its supported scope. Distinguish a local
override from the effective value inherited from a parent scope.

<!-- port:py -->
<!-- port:root -->
### Python
<!-- /port -->

**Read all (this scope):** `pane.show_options()`

**Read effective/inherited:** `pane.show_option(name, global_=True)` reaches the
global fallback explicitly; no separate "resolved" call

**Set:** `pane.set_option(name, value)`

**Unset:** `pane.unset_option(name)`

<!-- /port -->

<!-- port:ts -->
<!-- port:root -->
### TypeScript
<!-- /port -->

**Read all (this scope):** `pane.showOptions()`

**Read effective/inherited:** `pane.showResolvedOptions()`

**Set:** `pane.setOption(name, value)`

**Unset:** `pane.unsetOption(name)`

<!-- /port -->

<!-- port:go -->
<!-- port:root -->
### Go
<!-- /port -->

`pane.Options(ctx)` returns a fresh typed snapshot, including inherited values.
Its accessors return an `OptionValue`; use `OptionValue.Get` to distinguish a
present value from an absent one. Check the read error before inspecting the snapshot.

Use the handle that owns the option's scope. For example, `automatic-rename`
belongs to a window: use `Window.SetOption` or `Window.UnsetOption`, then read
`Window.Options` again for an updated snapshot.

For a single raw value, `Pane.RawOption` returns the string, its presence, and an
error. Do not treat an error as an absent option.

<!-- /port -->

<!-- port:rs -->
<!-- port:root -->
### Rust
<!-- /port -->

**Read all (this scope):** `pane.options()` (typed `BTreeMap`),
`pane.option_names()`

**Read effective/inherited:** `pane.typed_option(name)` decodes one value by its
declared kind

**Set:** `pane.set_option(name, value)`, `pane.append_option(name, value)`

**Unset:** `pane.unset_option(name)`

<!-- /port -->

<!-- port:java -->
<!-- port:root -->
### Java
<!-- /port -->

**Read all (this scope):** `pane.options().all()`

**Read effective/inherited:** `pane.options().get(name)` reads `show-options -A
-v`: inherited, not just local

**Set:** `pane.options().set(name, value)`

**Unset:** `pane.options().unset(name)`

<!-- /port -->

<!-- port:csharp -->
<!-- port:root -->
### C#
<!-- /port -->

**Read all (this scope):** `pane.Options.GetAllAsync()`

**Read effective/inherited:** `pane.Options.GetAsync(new GetOptionRequest(name,
includeInherited: true))`: an explicit opt-in flag, mapped straight to tmux's
own `-A`

**Set:** `pane.Options.SetAsync(new SetOptionRequest(name, value))`

**Unset:** `pane.Options.UnsetAsync(...)`

<!-- /port -->

<!-- port:cxx -->
<!-- port:root -->
### C++
<!-- /port -->

**Read all (this scope):** `pane->options()`

**Read effective/inherited:** Not listed.

**Set:** `pane->set_option(name, value)`

**Unset:** `pane->unset_option(name)`

<!-- /port -->

<!-- port:swift -->
<!-- port:root -->
### Swift
<!-- /port -->

**Read all (this scope):** `server.options(.pane(pane))`

**Read effective/inherited:** `server.option(name, scope: .pane(pane))` reads
presence from the listing, then the value with `-v`

**Set:** `server.setOption(name, to: value, scope: .pane(pane))`

**Unset:** `server.unsetOption(name, scope: .pane(pane))`

<!-- /port -->

### Examples

After a successful write completes, read the option to obtain its updated value.
The following examples set, read, and unset an option:

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
if err := window.SetOption(ctx, "automatic-rename", "off", tmux.SetOptionOptions{}); err != nil {
    return fmt.Errorf("set automatic rename: %w", err)
}
options, err := window.Options(ctx)
if err != nil {
    return fmt.Errorf("read window options: %w", err)
}
value, present := options.AutomaticRename().Get()
fmt.Println("automatic rename:", value, "present:", present)
if err := window.UnsetOption(ctx, "automatic-rename", tmux.UnsetOptionOptions{}); err != nil {
    return fmt.Errorf("unset automatic rename: %w", err)
}
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

<!-- port:py -->
<!-- port:root -->
### Python
<!-- /port -->

**Set:** `pane.set_hook(name, command)`

**Unset:** `pane.unset_hook(name)`

**List:** `pane.show_hook(name)`, `pane.show_hooks()` (all)

**Run now, without the event:** Not listed.

<!-- /port -->

<!-- port:ts -->
<!-- port:root -->
### TypeScript
<!-- /port -->

**Set:** `pane.setHook(name, command, { append })`

**Unset:** `pane.unsetHook(name)`

**List:** `pane.showHooks()` (all; no singular `showHook`)

**Run now, without the event:** Not listed.

<!-- /port -->

<!-- port:go -->
<!-- port:root -->
### Go
<!-- /port -->

Use `session.SetHook` to register a command and `session.Hooks` to read the
session's typed hook values. `session.UnsetHook` removes a registration.
`Session.SetHooks` writes indexed entries when an event needs more than one command.

Use `server.GlobalSessionScope()` for hooks shared by sessions. Keep hook
registration at a scope supported by the tmux event.

<!-- /port -->

<!-- port:rs -->
<!-- port:root -->
### Rust
<!-- /port -->

**Set:** `pane.set_hook(name, command)`

**Unset:** `pane.unset_hook(name)`

**List:** `pane.hook(name)`: one name only; **no listing at pane/window scope**,
by design (see below)

**Run now, without the event:** Not listed.

<!-- /port -->

<!-- port:java -->
<!-- port:root -->
### Java
<!-- /port -->

**Set:** `pane.hooks().set(event, command)`, `.append(event, command)`

**Unset:** `pane.hooks().unset(event)`

**List:** `pane.hooks().all()`

**Run now, without the event:** `pane.hooks().run(event)`: tmux's `set-hook -R`

<!-- /port -->

<!-- port:csharp -->
<!-- port:root -->
### C#
<!-- /port -->

**Set:** `pane.Hooks.SetAsync(new SetHookRequest(event, command))`

**Unset:** `pane.Hooks.UnsetAsync(...)`

**List:** `pane.Hooks.GetAllAsync()`

**Run now, without the event:** `pane.Hooks.RunAsync(...)`

<!-- /port -->

<!-- port:cxx -->
<!-- port:root -->
### C++
<!-- /port -->

**Set:** `session.set_hook(name, command)`: no `Window`/`Pane` overload exists
at all

**Unset:** Not listed.

**List:** `session.hooks()`, `server.global_hooks()`

**Run now, without the event:** Not listed.

<!-- /port -->

<!-- port:swift -->
<!-- port:root -->
### Swift
<!-- /port -->

**Set:** `server.setHook(name, to: command, at: index, in: scope)`

**Unset:** `server.unsetHook(name, in: scope)`

**List:** `server.hooks(scope)`

**Run now, without the event:** `server.runHook(name, in: scope)`

<!-- /port -->

### Examples

tmux stores hook commands in indexed arrays, such as `after-new-window[0]`.

<!-- port:py -->
Include the array index in the hook name.
<!-- /port -->
<!-- port:ts -->
Include the array index in the hook name or pass `{ append: true }` to append.
<!-- /port -->
<!-- port:go -->
`Session.SetHooks` accepts indexed hook entries. Pass a context and check errors from
both mutations and reads; a successful write does not refresh earlier snapshots.
<!-- /port -->
<!-- port:swift -->
The `at:` parameter selects the array index.
<!-- /port -->
<!-- port:java -->
Use `.append()` to add a command without choosing the next array index.
<!-- /port -->

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
if err := session.SetHook(ctx, "session-renamed", "display-message 'renamed'"); err != nil {
    return fmt.Errorf("set session hook: %w", err)
}
value, present, err := session.RawHook(ctx, "session-renamed")
if err != nil {
    return fmt.Errorf("read session hooks: %w", err)
}
fmt.Println("session-renamed:", value, "present:", present)
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

<!-- port:java -->
Check `hooks().all()` when diagnosing a hook that does not fire. tmux can accept
a hook at an unsupported scope without an effective registration.
<!-- /port -->

<!-- port:rs -->
`Pane::set_hook` and `Window::set_hook` return `Error::OptionScopeMismatch`
for an unsupported scope.
<!-- /port -->

<!-- port:swift -->
`HookScope` restricts registration to `.global` and `.session`.
<!-- /port -->

<!-- port:cxx -->
Use `Session::set_hook` or `Server::global_hooks()`. Window and pane handles
do not provide hook methods.
<!-- /port -->

Options have window and pane tables of their own. The hook-scope limitation does
not apply to ordinary options.

## tmux version compatibility

<!-- port:py -->
The compatibility notes list these tmux requirements:

| Feature | Minimum tmux |
|---------|-------------|
| All options/hooks features | 3.2+ |
| Window/pane hook *scope flags* (`-w`, `-p`) accepted | 3.2+; see the supported-scope caveat above |
| `client-active`, `window-resized` hooks | 3.3+ |
| `pane-title-changed` hook | 3.5+ |

<!-- /port -->

Check the library's supported tmux versions before using a version-specific
option or hook.

<!-- port:root -->
Use the command references for [show-options](/tmux/latest/manual/show-options/),
[set-option](/tmux/latest/manual/set-option/),
[show-hooks](/tmux/latest/manual/show-hooks/), and
[set-hook](/tmux/latest/manual/set-hook/) to check the flags and scope rules
for your tmux version.
<!-- /port -->

<details>
<summary>tmux manual and source</summary>

The tmux manual defines [option scopes and inherited reads](https://github.com/tmux/tmux/blob/94796f6b1182507efac8a272fc309a79e22e58a5/tmux.1#L4725).
Unsetting a local value restores inheritance. Hook programs run in tmux when
their event occurs; see the [hook implementation](https://github.com/tmux/tmux/blob/94796f6b1182507efac8a272fc309a79e22e58a5/cmd-set-option.c).

</details>
