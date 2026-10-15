---
port: rs
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

**Read all (this scope):** `pane.options()` (typed `BTreeMap`),
`pane.option_names()`

**Read effective/inherited:** `pane.typed_option(name)` decodes one value by its
declared kind

**Set:** `pane.set_option(name, value)`, `pane.append_option(name, value)`

**Unset:** `pane.unset_option(name)`

### Examples

After a successful write completes, read the option to obtain its updated value.
The following examples set, read, and unset an option:

```rust
pane.set_option("automatic-rename", "off").await?;
pane.options().await?;
pane.unset_option("automatic-rename").await?;
```

## Hooks

**Set:** `pane.set_hook(name, command)`

**Unset:** `pane.unset_hook(name)`

**List:** `pane.hook(name)`: one name only; **no listing at pane/window scope**,
by design (see below)

**Run now, without the event:** Not listed.

### Examples

tmux stores hook commands in indexed arrays, such as `after-new-window[0]`.

Set and list a session hook. The next section explains window and pane scope
limitations:

```rust
session.set_hook("session-renamed", "display-message 'renamed'").await?;
session.hooks().await?;
```

<a id="window-and-pane-hook-scopes-are-mostly-fiction"></a>

## Supported hook scopes

tmux stores hooks globally or per session. Accepted `set-hook -w` or `-p` flags
do not imply a separate window or pane hook table, and `show-hooks` does not
provide a corresponding listing. Check the event's supported scope if a hook is
accepted but never fires.

`Pane::set_hook` and `Window::set_hook` return `Error::OptionScopeMismatch`
for an unsupported scope.

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
