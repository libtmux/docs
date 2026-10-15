---
port: cxx
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

<a id="c-raii-exists-but-only-for-a-private-test-server"></a>

## Owning a test server

C++'s `Session`, `Window`, and `Pane` are non-owning values; destroying a handle
does not kill its tmux object. `libtmux::test::ScopedTmuxServer`, in the
separate `testing` CMake component, owns a private test server and its temporary
socket directory:

```cpp
auto fixture = libtmux::test::ScopedTmuxServer::start(
    {.socket_namespace = libtmux::test::SocketNamespace::consumer("my-suite")});
// fixture killed, and its tree removed, when this scope ends:
// even if the test that follows fails
```

<a id="what-this-means-in-practice"></a>

## Testing cleanup

Use explicit cleanup for objects whose handles have no disposal hook. For an
entire disposable test server, prefer your port's test fixture or server guard;
see [Testing with libtmux](/guides/testing-with-libtmux/).
