---
port: ts
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

**Read all (this scope):** `pane.showOptions()`

**Read effective/inherited:** `pane.showResolvedOptions()`

**Set:** `pane.setOption(name, value)`

**Unset:** `pane.unsetOption(name)`

### Examples

After a successful write completes, read the option to obtain its updated value.
The following examples set, read, and unset an option:

```typescript
await pane.setOption("automatic-rename", "off");
await pane.showOptions();
await pane.unsetOption("automatic-rename");
```

## Hooks

**Set:** `pane.setHook(name, command, { append })`

**Unset:** `pane.unsetHook(name)`

**List:** `pane.showHooks()` (all; no singular `showHook`)

**Run now, without the event:** Not listed.

### Examples

tmux stores hook commands in indexed arrays, such as `after-new-window[0]`.

Include the array index in the hook name or pass `{ append: true }` to append.

Set and list a session hook. The next section explains window and pane scope
limitations:

```typescript
await session.setHook("session-renamed", "display-message 'renamed'");
await session.showHooks();
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
