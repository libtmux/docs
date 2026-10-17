---
port: py
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

**Read all (this scope):** `pane.show_options()`

**Read effective/inherited:** `pane.show_option(name, global_=True)` reaches the
global fallback explicitly; no separate "resolved" call

**Set:** `pane.set_option(name, value)`

**Unset:** `pane.unset_option(name)`

### Examples

After a successful write completes, read the option to obtain its updated value.
The following examples set, read, and unset an option:

```python
pane.set_option("automatic-rename", "off")
pane.show_options()
pane.unset_option("automatic-rename")
```

## Hooks

**Set:** `pane.set_hook(name, command)`

**Unset:** `pane.unset_hook(name)`

**List:** `pane.show_hook(name)`, `pane.show_hooks()` (all)

**Run now, without the event:** Not listed.

### Examples

tmux stores hook commands in indexed arrays, such as `after-new-window[0]`.

Include the array index in the hook name.

Set and list a session hook. The next section explains window and pane scope
limitations:

```python
session.set_hook("session-renamed", "display-message 'renamed'")
session.show_hooks()
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

The compatibility notes list these tmux requirements:

| Feature | Minimum tmux |
|---------|-------------|
| All options/hooks features | 3.3a+ |
| Window/pane hook *scope flags* (`-w`, `-p`) accepted | 3.3a+; see the supported-scope caveat above |
| `client-active`, `window-resized` hooks | 3.3+ |
| `pane-title-changed` hook | 3.2+ |

The `pane-title-changed` hook was
[added before tmux 3.2](https://github.com/tmux/tmux/commit/d329b035cee47d968a8c93b5cbd8fde879ce6f0d).
It is present in both the documented
[3.2a source](https://github.com/tmux/tmux/blob/3b929f332aafa7f1080eacc31feb11ffbb1d1841/options-table.c#L1143)
and the
[3.7c source](https://github.com/tmux/tmux/blob/e476c1230b958df0cb12977517d24b3dc931375b/options-table.c#L1700).

Check the library's supported tmux versions before using a version-specific
option or hook.

<details>
<summary>tmux manual and source</summary>

The tmux manual defines [option scopes and inherited reads](https://github.com/tmux/tmux/blob/94796f6b1182507efac8a272fc309a79e22e58a5/tmux.1#L4725).
Unsetting a local value restores inheritance. Hook programs run in tmux when
their event occurs; see the [hook implementation](https://github.com/tmux/tmux/blob/94796f6b1182507efac8a272fc309a79e22e58a5/cmd-set-option.c).

</details>
