---
port: go
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

## Defer cleanup with a fresh context

A `Session`, `Window`, or `Pane` handle does not own its tmux object. Dropping
the value leaves tmux running. Register cleanup after successful creation and
use a separate, bounded context so cancellation of the work cannot prevent
cleanup. Return cleanup failures along with any work failure:

```go
func temporarySession(ctx context.Context, server tmux.Server) (err error) {
    session, err := server.NewSession(ctx, tmux.NewSessionRequest{})
    if err != nil {
        return err
    }
    defer func() {
        cleanup, cancel := context.WithTimeout(context.Background(), time.Second)
        defer cancel()
        err = errors.Join(err, session.Kill(cleanup))
    }()
    _, err = session.SearchWindows(ctx, nil)
    return err
}
```

This function uses `context`, `errors`, `time`, and the `tmux` package. It owns
only the session it creates. Do not kill a shared server as session cleanup.

`ControlClient`, `PaneObservation`, and `NotificationStream` implement
`io.Closer`. Close those resources separately from killing tmux objects.
For tests, `tmuxtest.NewServer` registers isolated server cleanup with the
Go test runner.

<a id="what-this-means-in-practice"></a>

## Testing cleanup

Use explicit cleanup for objects whose handles have no disposal hook. For an
entire disposable test server, prefer your port's test fixture or server guard;
see [Testing with libtmux](/guides/testing-with-libtmux/).
