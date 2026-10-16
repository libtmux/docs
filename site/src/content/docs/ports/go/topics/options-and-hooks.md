---
port: go
route: topics/options-and-hooks
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

`pane.Options(ctx)` returns a fresh typed snapshot, including inherited values.
Its accessors return an `OptionValue`; use `OptionValue.Get` to distinguish a
present value from an absent one. Check the read error before inspecting the snapshot.

Use the handle that owns the option's scope. For example, `automatic-rename`
belongs to a window: use `Window.SetOption` or `Window.UnsetOption`, then read
`Window.Options` again for an updated snapshot.

For a single raw value, `Pane.RawOption` returns the string, its presence, and an
error. Do not treat an error as an absent option.

### Examples

After a successful write completes, read the option to obtain its updated value.
The following examples set, read, and unset an option:

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

## Hooks

Use `session.SetHook` to register a command and `session.Hooks` to read the
session's typed hook values. `session.UnsetHook` removes a registration.
`Session.SetHooks` writes indexed entries when an event needs more than one command.

Use `server.GlobalSessionScope()` for hooks shared by sessions. Keep hook
registration at a scope supported by the tmux event.

### Examples

tmux stores hook commands in indexed arrays, such as `after-new-window[0]`.

`Session.SetHooks` accepts indexed hook entries. Pass a context and check errors from
both mutations and reads; a successful write does not refresh earlier snapshots.

Set and list a session hook. The next section explains window and pane scope
limitations:

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

<a id="window-and-pane-hook-scopes-are-mostly-fiction"></a>

## Supported hook scopes

tmux stores hooks globally or per session. Accepted `set-hook -w` or `-p` flags
do not imply a separate window or pane hook table, and `show-hooks` does not
provide a corresponding listing. Check the event's supported scope if a hook is
accepted but never fires.

Options have window and pane tables of their own. The hook-scope limitation does
not apply to ordinary options.

## tmux version compatibility

Check the library's supported tmux versions before using a version-specific
option or hook.

<details>
<summary>tmux manual and source</summary>

The tmux manual defines [option scopes and inherited reads](https://github.com/tmux/tmux/blob/94796f6b1182507efac8a272fc309a79e22e58a5/tmux.1#L4725).
Unsetting a local value restores inheritance. Hook programs run in tmux when
their event occurs; see the [hook implementation](https://github.com/tmux/tmux/blob/94796f6b1182507efac8a272fc309a79e22e58a5/cmd-set-option.c).

</details>
