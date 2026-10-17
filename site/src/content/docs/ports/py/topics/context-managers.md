---
port: py
route: topics/context-managers
title: Ownership and cleanup
description: Scope-based cleanup for tmux objects, and when your program must kill them explicitly.
sidebar:
  label: Ownership and cleanup
  group: Topics
  order: 4
tableOfContents: true
---

A tmux session, window, or pane normally remains until you kill it. Scope-based
cleanup can kill it when your code leaves a block, including after an exception.
See [Workspaces](/concepts/workspaces/) for a temporary layout example.

<a id="python-every-level-including-nested"></a>

## Nested context managers

Python's `Server`, `Session`, `Window`, and `Pane` support context managers.
Entry returns the existing object; exit kills it, including when the block
raises:

```python
with Server() as server:
    with server.new_session() as session:
        with session.new_window() as window:
            with window.split() as pane:
                pane.send_keys('echo "Hello"')
                # everything above is killed on the way out, in reverse order
```

Nested scopes exit in reverse order: pane, window, session, then server.

<a id="what-this-means-in-practice"></a>

## Testing cleanup

Use explicit cleanup for objects whose handles have no disposal hook. For an
entire disposable test server, prefer your port's test fixture or server guard;
see [Testing with libtmux](/guides/testing-with-libtmux/).
